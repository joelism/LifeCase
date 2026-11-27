import SwiftUI
import UIKit

@MainActor
final class HealthAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Task { @MainActor in await HealthSync.shared.restore() }
        return true
    }
}

@main
@MainActor
struct LifeCaseHealthApp: App {
    @UIApplicationDelegateAdaptor(HealthAppDelegate.self) private var delegate
    @StateObject private var sync = HealthSync.shared

    var body: some Scene {
        WindowGroup {
            HealthHome(sync: sync)
        }
    }
}

struct HealthHome: View {
    @ObservedObject var sync: HealthSync
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var challenge = false
    @State private var busy = false
    @State private var days = 30
    @State private var error = ""
    private let api = LifeCaseAPI.shared

    var body: some View {
        NavigationStack {
            Form {
                if sync.ready { healthControls } else { signIn }
                if !error.isEmpty {
                    Section { Text(error).foregroundStyle(.red) }
                }
                if sync.ready {
                    Section {
                        Link("LifeCase im Web öffnen", destination: URL(string: "https://joelism.github.io/LifeCase/")!)
                        Button("Abmelden", role: .destructive) {
                            run { await sync.signOut(); challenge = false }
                        }
                    }
                }
            }
            .navigationTitle("LifeCase Health")
        }
    }

    private var signIn: some View {
        Section {
            if challenge {
                TextField("Sicherheitscode", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                Button("Bestätigen") {
                    run { try await api.verify(code: code); code = ""; sync.ready = true }
                }
                .disabled(code.count != 6 || busy)
                Button("Zurück zur Anmeldung") { challenge = false; code = ""; error = "" }
            } else {
                TextField("E-Mail-Adresse", text: $email).keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Passwort", text: $password).textContentType(.password)
                Button("Anmelden") {
                    run {
                        defer { password = "" }
                        try await api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
                        challenge = true
                    }
                }
                .disabled(email.isEmpty || password.isEmpty || busy)
            }
        } header: {
            Text("LifeCase-Konto")
        } footer: {
            Text("Verwende dasselbe Konto und denselben Authenticator wie in der Web-App.")
        }
    }

    private var healthControls: some View {
        Group {
            Section("Messwerte") {
                ForEach(Metric.allCases) { metric in
                    Toggle(metric.label, isOn: Binding(get: { sync.selected.contains(metric) }, set: { enabled in
                        if enabled { sync.selected.insert(metric) } else { sync.selected.remove(metric) }
                    }))
                }
            }
            Section {
                Picker("Zeitraum", selection: $days) {
                    Text("7 Tage").tag(7)
                    Text("30 Tage").tag(30)
                    Text("90 Tage").tag(90)
                }
                Toggle("Im Hintergrund abgleichen", isOn: $sync.automatic)
                    .onChange(of: sync.automatic) { _, enabled in
                        if !enabled { Task { await sync.applyAutomaticSetting() } }
                    }
                Button("Freigeben und synchronisieren") {
                    run { try await sync.requestAndSync(days: days) }
                }
                .disabled(busy || sync.working || sync.selected.isEmpty)
                if sync.working { ProgressView("Werte werden übertragen …") }
                if !sync.feedback.isEmpty { Text(sync.feedback).foregroundStyle(.secondary) }
            } footer: {
                Text("LifeCase speichert die gewählten Tageswerte in deinem persönlichen Konto. Die Originaldaten bleiben in Apple Health.")
            }
        }
    }

    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        error = ""
        Task { @MainActor in
            defer { busy = false }
            do { try await operation() }
            catch { self.error = error.localizedDescription }
        }
    }
}
