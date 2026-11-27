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

## LifeCase 2.1

- **Einkaufen** speichert mehrere Einkaufslisten mit Mengen und abhaktbarem Zustand im LifeCase-Konto.
- **Scannen** liest Fotos im Browser. Die Texterkennung lädt ihre OCR-Komponenten bei Bedarf. Originalbilder werden beim Speichern optional in den privaten Dokumentenspeicher übertragen. Bei Teamplänen wird die angegebene Namenszeile mit den Datumsüberschriften abgeglichen. Prüfe die Vorschau, bevor du Schichten übernimmst.
- **Terminprüfung** verwendet einen integrierten Textklassifikator und prüft Datumsangaben im Originaltext. Sie verarbeitet seit der Aktivierung eingegangene Nachrichten in verbundenen Konten. Eindeutige Termine können direkt übernommen werden. Unverbindliche Angaben, Terminänderungen und Fälle mit mehreren Möglichkeiten erscheinen als Vorschläge. Diese Einstellung wird nach der Kontoverbindung in LifeCase aktiviert.
- Die Mailprüfung läuft um 08:00, 14:00 und 20:00 Uhr in der Zeitzone Europe/Zurich. Die Edge Function empfängt geplante Aufrufe über einen gesonderten, in Vault verwalteten Schlüssel. Für die Auswertung der Nachrichten ist kein externer KI-Dienst erforderlich.

## LifeCase 2.2

- **Terminassistent** nimmt kurze Termineingaben im Chat entgegen und fragt fehlende Angaben nach. Eindeutige Eingaben werden direkt im Kalender gespeichert. Die Verarbeitung läuft innerhalb von LifeCase.
- **Kalenderabstände** zeigen «Knapp» bei bis zu 15 Minuten Abstand ab einem bekannten Terminende. Wenn die Endzeit fehlt, zählen bis zu 30 Minuten Abstand zwischen Beginnzeiten. Sich tatsächlich überschneidende Einträge werden separat markiert.
- **Rezepte und Arztzeugnisse** erhalten standardmässig eine Erinnerung einen Kalendermonat vor Ablauf. Die Erinnerung lässt sich einzeln ausschalten. Unter **Erinnerungen** kann das Gerät Push abonnieren. LifeCase prüft Ablaufdaten täglich um 08:00 Uhr Schweizer Zeit. Der Hinweis auf dem Sperrbildschirm enthält keine Dokumentdetails. Auf dem iPhone LifeCase über Safari dem Home-Bildschirm hinzufügen und von dort öffnen.
- **Google Drive** nutzt die Google-OAuth-Registrierung aus Version 2.0 mit einer eigenen Lesefreigabe für Drive. Zusätzlich die Google Drive API im selben Google-Cloud-Projekt aktivieren. In **Google Drive** verbinden und einzelne Bilder oder PDFs in den privaten LifeCase-Speicher übernehmen. Es können bereits vorhandene Fälle, Arztzeugnisse oder Rezepte als Ziel gewählt werden.
- **Mailprüfung** läuft neu um 08:00, 12:00, 16:00 und 20:00 Uhr in der Zeitzone Europe/Zurich.

## Pausen im Terminassistenten

Mit «Finde mir morgen eine Mittagspause» schlägt LifeCase standardmässig 45 Minuten zwischen 12:00 und 14:00 Uhr vor. Ein passender Vorschlag kann auch auf der Tagesübersicht erscheinen. LifeCase berücksichtigt gespeicherte Schichten und verbundene Kalender und prüft die Zeit nach der Bestätigung erneut. Mit «30 Minuten Mittagspause morgen» kann die Dauer geändert werden.

Die Pause kann im LifeCase-Kalender gespeichert werden. Für einen verbundenen Outlook- oder Google-Kalender ist unter **Verbindungen** eine zusätzliche Schreibfreigabe nötig. Danach kann der Hauptkalender im Vorschlag ausgewählt werden. Dort wird die Pause privat als belegt gespeichert.

## LifeCase 2.3

- **Meine Woche** zeigt die nächsten sieben Tage mit Terminen, Schichten, Aufgaben und Fristen. Überfällige und undatierte Aufgaben bleiben griffbereit und lassen sich direkt erledigen.
- **Vorbereitung** speichert Fragen, Stichpunkte und eine abhakbare Liste zu einem Termin. Verknüpfte Dossiers bringen passende Unterlagen in die Ansicht.
- **Wiedervorlage** legt aus einem Dossier oder Eintrag eine verknüpfte Aufgabe an. Im Chat funktionieren auch Eingaben wie «Bis Freitag IV anrufen» und «Aufgabe: Milch kaufen».
