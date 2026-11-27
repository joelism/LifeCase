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
