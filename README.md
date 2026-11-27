# LifeCase

LifeCase verwaltet persönliche Dossiers, Chronik, Gesundheit, Arztzeugnisse, Gespräche, Kalender, Beweismittel und Kontakte. Die App ist eine statisch bereitgestellte PWA mit Supabase Auth, der Supabase Data API und privatem Supabase Storage.

## Entwicklung

Node.js 22.12 oder neuer verwenden.

```sh
npm ci
npm test
npm run dev
npm run build
```

Das Build-Verzeichnis ist `dist/`. Die PWA verwendet relative Pfade und kann unter einem Unterpfad veröffentlicht werden. Der Release-Build erzeugt einen Service Worker, dessen Cache ausschliesslich statische Anwendungsdateien enthält.

## Datenbank und Zugriff

Die Migrationen betreffen die drei LifeCase-Tabellen, die Schemafunktionen für LifeCase und den Bucket `lifecase-private`. Für den vorhandenen Supabase-Bestand prüfen, welche Migrationen bereits angewendet wurden. Die Browserkonfiguration enthält ausschliesslich den öffentlichen Supabase-Projektschlüssel. Ein Supabase-Konto mit Passwort und einem bestätigten TOTP-Faktor ist für den Zugriff erforderlich.

Die Anwendung speichert Originaldateien einmalig unter einer Besitzer- und Datei-ID. Metadaten und SHA-256 werden beim Upload erfasst, der Download prüft den Hash erneut. Einträge lassen sich archivieren und wiederherstellen. Änderungen und neue Originaldateien erzeugen serverseitige Verlaufseinträge. Authentifizierte Anwendungsanfragen werden ohne Browser-Cache gesendet.

Kalenderdateien mit Erinnerungen sowie PDFs werden auf dem Gerät erzeugt. Die globale Suche berücksichtigt Einträge, Verknüpfungen und Dateimetadaten. Hinweise ausserhalb der App werden durch den Import in einen Gerätekalender eingerichtet.

## LifeCase 2.0

In **Posteingang** erscheinen die verbundenen Konten. Dort lassen sich auch lokal gespeicherte .eml-Dateien öffnen und importieren. Nachrichten werden erst bei der Auswahl eines Dossiers gespeichert. Wenn gewünscht, legt LifeCase die .eml-Datei und ausgewählte Anhänge im privaten Originalspeicher ab. Der Import kann nach einem unterbrochenen Datei-Upload wiederholt werden. Die Option für eine anschliessende Aufgabe öffnet den Kalendereditor mit Verknüpfung zum Dossier und zur Nachricht.

Der Kalender zeigt LifeCase-Termine und die freigegebenen Anbietertermine in Schweizer Zeit. Externe Termine werden live abgerufen. In **Gesundheitsdaten** kann ein ZIP- oder XML-Export aus Apple Health im Browser ausgewertet werden. Gespeichert werden die ausgewählten Tageswerte und ihre Quelle.

### Outlook und Google für LifeCase registrieren

1. Microsoft Entra: Web-Anwendung mit Unterstützung für persönliche Microsoft-Konten und delegiertem Zugriff `User.Read`, `Mail.Read` und `Calendars.Read` registrieren. Bei der Web-Redirect-URI die unten angegebene Adresse hinterlegen.
2. Google Cloud: Gmail API und Google Calendar API aktivieren. Einen OAuth-Client vom Typ Webanwendung registrieren und dieselbe Adresse als autorisierte Weiterleitungs-URI hinterlegen. Für den persönlichen Zugang die eigene Google-Adresse entsprechend dem gewählten Veröffentlichungsmodus freigeben.
3. In Supabase Vault die vier Werte unter `lifecase_microsoft_client_id`, `lifecase_microsoft_client_secret`, `lifecase_google_client_id` und `lifecase_google_client_secret` speichern. Der Funktionscode liest diese Werte serverseitig. Danach unter **Verbindungen** den Status prüfen und das gewünschte Konto verbinden.

Weiterleitungsadresse für beide Anbieter:

```text
https://gmulchykvjxkbpcfnspg.supabase.co/functions/v1/lifecase-connect/callback
```

Die Edge Function `lifecase-connect` verlangt eine bestätigte LifeCase-Anmeldung mit zweitem Faktor. Der Callback des Anbieters verwendet einen einmal einlösbaren, zeitlich begrenzten OAuth-State sowie PKCE. Die Anbieter-Tokens liegen in Supabase Vault. Erlaubte Web-Ursprünge stehen in `supabase/functions/lifecase-connect/index.js`.

### Apple Health auf dem iPhone

Das Projekt [LifeCaseHealth.xcodeproj](ios/LifeCaseHealth.xcodeproj) in Xcode öffnen. Für das Target **LifeCaseHealth** unter **Signing & Capabilities** das eigene Apple-Entwicklerteam wählen und bei Bedarf den Bundle Identifier ändern. Auf einem iPhone mit iOS 17 oder neuer installieren und dasselbe LifeCase-Konto samt Authenticator verwenden. Die App fordert Lesefreigaben für die ausgewählten HealthKit-Messwerte an. Sie unterstützt den manuellen Abgleich sowie von iOS zugestellte Hintergrundupdates, wenn diese Option aktiviert und vom Gerät unterstützt wird. Im Web erscheint der Verlauf unter **Gesundheitsdaten**.

### GitHub Pages

Die bestehende Veröffentlichung verwendet das Stammverzeichnis von `main`. Nach Änderungen mit `npm run build:pages` die statischen Dateien im Stammverzeichnis neu erzeugen und mit den Änderungen committen. `web/index.html` ist die HTML-Quelle. Der Build für die private Site liegt weiterhin in `dist/`. Die GitHub-Version speichert ihre Anmeldung nur im Arbeitsspeicher des Tabs, weil mehrere GitHub-Projektseiten dieselbe Browser-Origin teilen.
