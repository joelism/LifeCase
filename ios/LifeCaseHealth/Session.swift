import Foundation
import Security

enum LifeCaseError: LocalizedError {
    case explanation(String)

    var errorDescription: String? {
        if case let .explanation(text) = self { return text }
        return nil
    }
}

struct SignInResponse: Decodable {
    struct User: Decodable {
        struct Factor: Decodable {
            let id: String
            let factor_type: String
            let status: String
        }
        let factors: [Factor]?
    }
    let access_token: String
    let refresh_token: String
    let expires_in: Int?
    let user: User?

    var session: LifeCaseSession {
        LifeCaseSession(access: access_token, refresh: refresh_token,
                        expires: Date().addingTimeInterval(TimeInterval(expires_in ?? 3600)))
    }
}

struct LifeCaseSession: Codable {
    let access: String
    let refresh: String
    let expires: Date

    var hasSecondFactor: Bool {
        let parts = access.split(separator: ".")
        guard parts.count == 3 else { return false }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let bytes = Data(base64Encoded: payload),
              let object = (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any] else { return false }
        return object["aal"] as? String == "aal2"
    }
}

private enum SessionKeychain {
    private static var attributes: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "ch.lifecase.health",
         kSecAttrAccount as String: "session"]
    }

    static func load() -> LifeCaseSession? {
        var query = attributes
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let raw = item as? Data else { return nil }
        return try? JSONDecoder().decode(LifeCaseSession.self, from: raw)
    }

    static func save(_ session: LifeCaseSession) throws {
        let data = try JSONEncoder().encode(session)
        let change = [kSecValueData as String: data]
        let result = SecItemUpdate(attributes as CFDictionary, change as CFDictionary)
        if result == errSecSuccess { return }
        guard result == errSecItemNotFound else { throw LifeCaseError.explanation("Das iPhone konnte die Anmeldung nicht sichern.") }
        var item = attributes
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw LifeCaseError.explanation("Das iPhone konnte die Anmeldung nicht sichern.")
        }
    }

    static func clear() { SecItemDelete(attributes as CFDictionary) }
}

actor LifeCaseAPI {
    static let shared = LifeCaseAPI()
    private let origin = URL(string: "https://gmulchykvjxkbpcfnspg.supabase.co")!
    private let key = "sb_publishable_hvQaG7GA94e9a7W1ljt5bw_rU1HNiyz"
    private let network: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()
    private var current: LifeCaseSession? = SessionKeychain.load()
    private var temporary: (access: String, factor: String)?
    private var updating: Task<LifeCaseSession, Error>?
    private var generation = 0

    func login(email: String, password: String) async throws {
        let body = try JSONEncoder().encode(["email": email, "password": password])
        let data = try await call("/auth/v1/token?grant_type=password", body: body)
        let result = try JSONDecoder().decode(SignInResponse.self, from: data)
        var user = result.user
        if user?.factors == nil {
            let profile = try await call("/auth/v1/user", method: "GET", token: result.access_token)
            user = try JSONDecoder().decode(SignInResponse.User.self, from: profile)
        }
        guard let factor = user?.factors?.first(where: { $0.factor_type == "totp" && $0.status == "verified" }) else {
            throw LifeCaseError.explanation("Richte zuerst in der LifeCase-Web-App einen Authenticator ein.")
        }
        temporary = (result.access_token, factor.id)
    }

    func verify(code: String) async throws {
        struct Challenge: Decodable { let id: String }
        guard let pending = temporary else { throw LifeCaseError.explanation("Melde dich erneut an.") }
        let base = "/auth/v1/factors/" + pending.factor
        let data = try await call(base + "/challenge", token: pending.access, body: Data("{}".utf8))
        let challenge = try JSONDecoder().decode(Challenge.self, from: data)
        let body = try JSONEncoder().encode(["code": code, "challenge_id": challenge.id])
        let verified = try await call(base + "/verify", token: pending.access, body: body)
        let response = try JSONDecoder().decode(SignInResponse.self, from: verified).session
        guard response.hasSecondFactor else { throw LifeCaseError.explanation("Der Sicherheitscode konnte nicht bestätigt werden.") }
        try SessionKeychain.save(response)
        current = response
        temporary = nil
    }

    func remembered() -> Bool { current?.hasSecondFactor == true }

    private func activeSession() async throws -> LifeCaseSession {
        guard let session = current, session.hasSecondFactor else { throw LifeCaseError.explanation("Melde dich in LifeCase an.") }
        if session.expires.timeIntervalSinceNow > 90 { return session }
        if let updating { return try await updating.value }
        let epoch = generation
        let refresh = Task {
            let body = try JSONEncoder().encode(["refresh_token": session.refresh])
            let data = try await call("/auth/v1/token?grant_type=refresh_token", body: body)
            let result = try JSONDecoder().decode(SignInResponse.self, from: data).session
            guard generation == epoch, result.hasSecondFactor else { throw LifeCaseError.explanation("Melde dich erneut an.") }
            try SessionKeychain.save(result)
            current = result
            return result
        }
        updating = refresh
        defer { if generation == epoch { updating = nil } }
        return try await refresh.value
    }

    func save(_ rows: [HealthDay]) async throws {
        for start in stride(from: 0, to: rows.count, by: 150) {
            let session = try await activeSession()
            let body = try JSONEncoder().encode(Array(rows[start..<min(start + 150, rows.count)]))
            _ = try await call("/rest/v1/lifecase_health_days?on_conflict=user_id,day,metric,source",
                               token: session.access, body: body, preference: "resolution=merge-duplicates,return=minimal")
        }
    }

    func signOut() async {
        let token = current?.access
        generation += 1
        updating?.cancel()
        updating = nil
        current = nil
        temporary = nil
        SessionKeychain.clear()
        if let token { _ = try? await call("/auth/v1/logout?scope=local", token: token) }
    }

    private func call(_ path: String, method: String = "POST", token: String? = nil, body: Data? = nil, preference: String? = nil) async throws -> Data {
        var request = URLRequest(url: URL(string: path, relativeTo: origin)!)
        request.httpMethod = method
        request.setValue(key, forHTTPHeaderField: "apikey")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let preference { request.setValue(preference, forHTTPHeaderField: "Prefer") }
        let (data, response) = try await network.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let text: String
            if path.hasSuffix("/verify") { text = "Der Sicherheitscode ist ungültig oder abgelaufen." }
            else if path.hasSuffix("grant_type=password") { text = "Die Anmeldung ist fehlgeschlagen. Prüfe E-Mail-Adresse und Passwort." }
            else if status == 401 || status == 403 || path.hasSuffix("grant_type=refresh_token") { text = "Die Anmeldung ist abgelaufen. Melde dich erneut an." }
            else { text = "LifeCase ist gerade nicht erreichbar. Versuche es erneut." }
            throw LifeCaseError.explanation(text)
        }
        return data
    }
}
