import Foundation
import HealthKit
import SwiftUI

enum Metric: String, CaseIterable, Identifiable {
    case steps, sleep, weight, exercise, resting
    var id: String { rawValue }

    var label: String {
        switch self {
        case .steps: "Schritte"
        case .sleep: "Schlaf"
        case .weight: "Gewicht"
        case .exercise: "Bewegungsminuten"
        case .resting: "Ruhepuls"
        }
    }

    var type: HKSampleType? {
        switch self {
        case .steps: HKQuantityType.quantityType(forIdentifier: .stepCount)
        case .sleep: HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
        case .weight: HKQuantityType.quantityType(forIdentifier: .bodyMass)
        case .exercise: HKQuantityType.quantityType(forIdentifier: .appleExerciseTime)
        case .resting: HKQuantityType.quantityType(forIdentifier: .restingHeartRate)
        }
    }

    var maximum: Double {
        switch self {
        case .steps: 250000
        case .sleep: 24
        case .weight: 1000
        case .exercise: 1440
        case .resting: 400
        }
    }
}

struct HealthDay: Encodable {
    let day: String
    let metric: String
    let value: Double
    let source = "healthkit"
    let source_name = "Apple Health"
}

@MainActor
final class HealthSync: ObservableObject {
    static let shared = HealthSync()
    private let store = HKHealthStore()
    private let api = LifeCaseAPI.shared
    private var observers: [HKObserverQuery] = []
    private var cycle = 0
    @Published var selected: Set<Metric> = Set((UserDefaults.standard.stringArray(forKey: "healthMetrics") ?? [])
        .compactMap(Metric.init(rawValue:)))
    @Published var automatic = UserDefaults.standard.bool(forKey: "healthAutomatic")
    @Published var ready = false
    @Published var working = false
    @Published var feedback = ""

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Zurich")!
        return calendar
    }

    private func day(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    func restore() async {
        ready = await api.remembered()
        if ready && automatic { await observe() }
    }

    func signOut() async {
        cycle += 1
        ready = false
        selected = []
        automatic = false
        UserDefaults.standard.removeObject(forKey: "healthMetrics")
        UserDefaults.standard.removeObject(forKey: "healthAutomatic")
        feedback = ""
        await stopObservers()
        await api.signOut()
    }

    func requestAndSync(days: Int) async throws {
        guard HKHealthStore.isHealthDataAvailable() else { throw LifeCaseError.explanation("Apple Health ist auf diesem Gerät nicht verfügbar.") }
        guard !selected.isEmpty else { throw LifeCaseError.explanation("Wähle mindestens einen Messwert aus.") }
        let read: Set<HKObjectType> = Set(selected.compactMap(\.type).map { $0 as HKObjectType })
        try await store.requestAuthorization(toShare: [], read: read)
        UserDefaults.standard.set(selected.map(\.rawValue), forKey: "healthMetrics")
        UserDefaults.standard.set(automatic, forKey: "healthAutomatic")
        await stopObservers()
        if automatic { await observe() }
        try await sync(days: days, show: true)
    }

    func applyAutomaticSetting() async {
        UserDefaults.standard.set(automatic, forKey: "healthAutomatic")
        if automatic && ready { await observe() } else { await stopObservers() }
    }

    private func stopObservers() async {
        for observer in observers { store.stop(observer) }
        observers.removeAll()
        if HKHealthStore.isHealthDataAvailable() { try? await store.disableAllBackgroundDelivery() }
    }

    private func observe() async {
        guard observers.isEmpty, HKHealthStore.isHealthDataAvailable() else { return }
        let configured = (UserDefaults.standard.stringArray(forKey: "healthMetrics") ?? []).compactMap(Metric.init(rawValue:))
        for type in configured.compactMap(\.type) {
            guard automatic && ready else { break }
            let observer = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, problem in
                Task { @MainActor in
                    defer { completion() }
                    guard problem == nil, let self, self.ready, self.automatic else { return }
                    try? await self.sync(days: 7, show: false)
                }
            }
            store.execute(observer)
            observers.append(observer)
            do { try await store.enableBackgroundDelivery(for: type, frequency: .hourly) }
            catch { feedback = "Hintergrundupdates sind aktuell nicht verfügbar. Du kannst weiterhin manuell abgleichen." }
        }
    }

    private func sync(days: Int, show: Bool) async throws {
        guard ready, !working else { return }
        let active = cycle
        working = true
        defer { working = false }
        let through = Date()
        let midnight = calendar.startOfDay(for: through)
        let from = calendar.date(byAdding: .day, value: 1 - days, to: midnight)!
        let configured = (UserDefaults.standard.stringArray(forKey: "healthMetrics") ?? []).compactMap(Metric.init(rawValue:))
        var daily: [HealthDay] = []
        for metric in configured {
            let values = try await measurements(metric, from: from, through: through)
            guard ready, cycle == active else { return }
            daily += values
        }
        try await api.save(daily)
        if show && ready && cycle == active {
            feedback = daily.isEmpty ? "Für diese Auswahl sind keine freigegebenen Daten verfügbar." : "\(daily.count) Tageswerte wurden übertragen."
        }
    }

    private func measurements(_ metric: Metric, from: Date, through: Date) async throws -> [HealthDay] {
        guard let type = metric.type else { return [] }
        let readFrom = metric == .sleep ? calendar.date(byAdding: .day, value: -1, to: from)! : from
        let predicate = HKQuery.predicateForSamples(withStart: readFrom, end: through, options: .strictStartDate)
        let values: [(Date, Double)]
        switch metric {
        case .steps, .exercise, .resting:
            guard let quantity = type as? HKQuantityType else { return [] }
            let unit: HKUnit = metric == .steps ? .count() : metric == .exercise ? .minute() : HKUnit(from: "count/min")
            values = try await statistics(quantity, predicate: predicate, start: from, end: through, unit: unit, sum: metric != .resting)
        case .sleep:
            let samples = try await samples(type, predicate: predicate).compactMap { $0 as? HKCategorySample }
                .filter { [1, 3, 4, 5].contains($0.value) && $0.endDate >= from }
            let grouped = Dictionary(grouping: samples) { calendar.startOfDay(for: $0.endDate) }
            values = grouped.map { date, records in
                var merged: [(Date, Date)] = []
                for sample in records {
                    if let last = merged.last, sample.startDate <= last.1 {
                        merged[merged.count - 1].1 = max(last.1, sample.endDate)
                    } else { merged.append((sample.startDate, sample.endDate)) }
                }
                let seconds = merged.reduce(0.0) { $0 + $1.1.timeIntervalSince($1.0) }
                return (date, seconds / 3600)
            }
        case .weight:
            let samples = try await samples(type, predicate: predicate).compactMap { $0 as? HKQuantitySample }
            let grouped = Dictionary(grouping: samples) { calendar.startOfDay(for: $0.startDate) }
            values = grouped.compactMap { date, records in
                records.last.map { (date, $0.quantity.doubleValue(for: .gramUnit(with: .kilo))) }
            }
        }
        return values.filter { $0.1.isFinite && (0...metric.maximum).contains($0.1) }.map { date, value in
            HealthDay(day: day(date), metric: metric.rawValue, value: (value * 100).rounded() / 100)
        }
    }

    private func samples(_ type: HKSampleType, predicate: NSPredicate) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let order = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [order]) { _, results, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: results ?? []) }
            }
            store.execute(query)
        }
    }

    private func statistics(_ type: HKQuantityType, predicate: NSPredicate, start: Date, end: Date, unit: HKUnit, sum: Bool) async throws -> [(Date, Double)] {
        try await withCheckedThrowingContinuation { continuation in
            var interval = DateComponents(day: 1)
            interval.calendar = calendar
            interval.timeZone = calendar.timeZone
            let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: predicate,
                options: sum ? .cumulativeSum : .discreteAverage, anchorDate: start, intervalComponents: interval)
            query.initialResultsHandler = { _, results, error in
                if let error { continuation.resume(throwing: error); return }
                var values: [(Date, Double)] = []
                results?.enumerateStatistics(from: start, to: end) { statistics, _ in
                    if let value = sum ? statistics.sumQuantity() : statistics.averageQuantity() {
                        values.append((statistics.startDate, value.doubleValue(for: unit)))
                    }
                }
                continuation.resume(returning: values)
            }
            store.execute(query)
        }
    }
}
