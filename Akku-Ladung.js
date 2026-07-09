// CONFIGURATION - AKKU & FESTE WERTE
const LADEVERLUST_PROZENT = 20;  // Typischer Verlust des Ladegeräts (meist zw. 10% und 20%)
const AKKU_KAPAZITAET_WH = 625;  // Nennkapazität des Akkus laut Hersteller in Wh
const AKKU_ZUSTAND_PROZENT = 90; // Aktueller Zustand des Akkus (Health / SoH) in %

// CONFIGURATION - SLIDER & TEXT IDs (Bitte an deine Shelly-IDs anpassen!)
const SLIDER_START_LADESTAND_ID = "number:200";   // ID der Slider-Komponente für "Akku Start-Ladestand"
const SLIDER_ZIEL_LADESTAND_ID = "number:201";    // ID der Slider-Komponente für "Akku Ziel-Ladestand"
const TEXT_AKTUELLER_LADESTAND_ID = "text:200";   // ID der Text-Komponente für "Aktueller Ladestand"
const TEXT_LADEDATEN_ID = "text:201";             // ID der Text-Komponente für "Ladedaten"
const TEXT_LADESTATUS_ID = "text:202";            // ID der Text-Komponente für "Ladestatus" + Restzeit

// CONFIGURATION - ZUSÄTZLICHE LEISTUNGS-SICHERHEIT (AUTO-OFF)
const MIN_POWER_WATT = 75.0;      // Wenn die Leistung unter diesen Watt-Wert fällt...
const MIN_POWER_DURATION_SEC = 60; // ...und dort für X Sekunden bleibt, wird abgeschaltet.

const CHECK_INTERVAL_MS = 2000;  // Prüft alle 2 Sekunden

// Globale Variablen zum Tracken
let startEnergy = -1;
let timerHandle = null;
let lowPowerDurationCounter = 0;

// Hilfsfunktion zum Aktualisieren von Text-Komponenten
function updateTextComponent(componentId, textValue) {
    Shelly.call("Text.Set", { id: componentId.split(":")[1], value: textValue }, function(res, err, msg) {
        if (err !== 0) {
            print("Fehler beim Aktualisieren von " + componentId + ": " + msg);
        }
    });
}

// Hilfsfunktion zur Formatierung der verbleibenden Zeit
function formatRemainingTime(currentPower, remainingWh) {
    if (currentPower <= 5) { // Wenn kaum/keine Leistung anliegt
        return "--h --m";
    }
    // Zeit in Stunden = verbleibende Wh / aktuelle Leistung in Watt
    let hoursTotal = remainingWh / currentPower;
    let hours = Math.floor(hoursTotal);
    let minutes = Math.floor((hoursTotal - hours) * 60);
    
    return hours + "h " + minutes + "m";
}

function checkEnergy() {
    // 1. Hole Zustand des Schalters
    Shelly.call("Switch.GetStatus", { id: 0 }, function (switchResult, error_code, error_message) {
        if (error_code !== 0 || !switchResult.output) {
            if (timerHandle !== null) {
                print("Stecker ist aus. Überwachung pausiert.");
                Timer.clear(timerHandle);
                timerHandle = null;
                startEnergy = -1;
                lowPowerDurationCounter = 0;
                updateTextComponent(TEXT_AKTUELLER_LADESTAND_ID, "0.0 %");
                updateTextComponent(TEXT_LADEDATEN_ID, "0.0 / 0.0 Wh | 0 W");
                updateTextComponent(TEXT_LADESTATUS_ID, "Inaktiv / Aus");
            }
            return;
        }

        // 2. Hole Wert des Start-Sliders
        Shelly.call("Number.GetStatus", { id: SLIDER_START_LADESTAND_ID.split(":")[1] }, function (startSlider) {
            // 3. Hole Wert des Ziel-Sliders
            Shelly.call("Number.GetStatus", { id: SLIDER_ZIEL_LADESTAND_ID.split(":")[1] }, function (zielSlider) {
                
                let startLadezustand = startSlider ? startSlider.value : 79; 
                let zielLadezustand = zielSlider ? zielSlider.value : 85;    

                // DYNAMISCHE BERECHNUNG DES WH-LIMITS
                let realeKapazitaetWh = AKKU_KAPAZITAET_WH * (AKKU_ZUSTAND_PROZENT / 100);
                let prozentZuLaden = zielLadezustand - startLadezustand;
                let nettoWhZuLaden = realeKapazitaetWh * (prozentZuLaden / 100);
                let energyLimitWh = nettoWhZuLaden * (1 + (LADEVERLUST_PROZENT / 100));

                if (energyLimitWh <= 0) {
                    print("WARNUNG: Ziel bereits erreicht oder kleiner als Start!");
                    shutdown("Fehler: Ziel erreicht", "0.0 / 0.0 Wh | 0 W");
                    return;
                }

                let currentTotalEnergy = switchResult.aenergy.total;
                let currentPowerWatt = switchResult.apower;

                // Erster Durchlauf nach dem Einschalten: Setze die Start-Energie
                if (startEnergy === -1) {
                    startEnergy = currentTotalEnergy;
                    print("--- LADEÜBERWACHUNG GESTARTET ---");
                    
                    updateTextComponent(TEXT_AKTUELLER_LADESTAND_ID, startLadezustand.toFixed(1) + " %");
                    updateTextComponent(TEXT_LADEDATEN_ID, "0.0 / " + energyLimitWh.toFixed(1) + " Wh | " + currentPowerWatt.toFixed(1) + " W");
                    updateTextComponent(TEXT_LADESTATUS_ID, "Initialisiere Ladung...");
                    return;
                }

                let consumedWh = currentTotalEnergy - startEnergy;
                let geladeneNettoWh = consumedWh / (1 + (LADEVERLUST_PROZENT / 100));
                let aktuellerSchatzLadestand = startLadezustand + (geladeneNettoWh / realeKapazitaetWh) * 100;
                if (aktuellerSchatzLadestand > zielLadezustand) aktuellerSchatzLadestand = zielLadezustand;

                // BERECHNUNG DER RESTZEIT
                let remainingWh = energyLimitWh - consumedWh;
                if (remainingWh < 0) remainingWh = 0;
                let restzeitStr = formatRemainingTime(currentPowerWatt, remainingWh);

                // --- TEXT-KOMPONENTEN BEFÜLLEN ---
                updateTextComponent(TEXT_AKTUELLER_LADESTAND_ID, aktuellerSchatzLadestand.toFixed(1) + " %");
                
                let statsMsg = consumedWh.toFixed(1) + " / " + energyLimitWh.toFixed(1) + " Wh | " + currentPowerWatt.toFixed(1) + " W";
                updateTextComponent(TEXT_LADEDATEN_ID, statsMsg);

                print("Gemessen: " + consumedWh.toFixed(1) + " Wh / " + energyLimitWh.toFixed(1) + " Wh (~" + aktuellerSchatzLadestand.toFixed(1) + "%) | Restzeit: " + restzeitStr + " | Last: " + currentPowerWatt.toFixed(1) + " W");

                // --- PRÜFUNG 1: Mindestleistung unterschritten? ---
                if (currentPowerWatt < MIN_POWER_WATT) {
                    lowPowerDurationCounter += (CHECK_INTERVAL_MS / 1000);
                    let verbleibend = MIN_POWER_DURATION_SEC - lowPowerDurationCounter;
                    
                    print("-> Leistung niedrig! Aus in " + verbleibend.toFixed(0) + "s");
                    updateTextComponent(TEXT_LADESTATUS_ID, "Leistung niedrig! Standby in " + verbleibend.toFixed(0) + "s");
                    
                    if (lowPowerDurationCounter >= MIN_POWER_DURATION_SEC) {
                        print("SICHERHEITSABSCHALTUNG: Leistung zu lange niedrig.");
                        shutdown("Auto-Off: Geladen / Standby", statsMsg);
                        return;
                    }
                } else {
                    if (lowPowerDurationCounter > 0) {
                        lowPowerDurationCounter = 0;
                    }
                    updateTextComponent(TEXT_LADESTATUS_ID, "Ladung läuft... Noch ca. " + restzeitStr);
                }

                // --- PRÜFUNG 2: Wh-Limit erreicht? ---
                if (consumedWh >= energyLimitWh) {
                    print("ZIEL ERREICHT: Schalte aus...");
                    shutdown("Ziel erreicht: " + zielLadezustand + "%", statsMsg);
                }
            });
        });
    });
}

// Überarbeitete Abschaltfunktion mit sauberer Verteilung auf alle Felder
function shutdown(logReason, finalStats) {
    print("shutdown() aufgerufen wegen: " + logReason);

    // 1. Timer SOFORT löschen
    if (timerHandle !== null) {
        Timer.clear(timerHandle);
        timerHandle = null;
    }
    
    // 2. Variablen zurücksetzen
    startEnergy = -1;
    lowPowerDurationCounter = 0;

    // 3. Schalter ausschalten (Höchste Priorität zum Schutz des Relais)
    Shelly.call("Switch.Set", { id: 0, on: false }, function(res, err, msg) {
        if (err !== 0) {
            print("FEHLER beim Ausschalten: " + msg);
        }
        
        // 4. Nach dem Ausschalten die Dashboard-Felder beschreiben
        updateTextComponent(TEXT_AKTUELLER_LADESTAND_ID, "0.0 %");
        if (finalStats) updateTextComponent(TEXT_LADEDATEN_ID, finalStats);
        if (logReason) updateTextComponent(TEXT_LADESTATUS_ID, logReason);
    });
}

// Event-Listener: Erkennt das Einschalten des Geräts
Shelly.addEventHandler(function (event) {
    if (event.component === "switch:0") {
        if (event.info.output === true || (event.info.event === "toggle" && event.info.state === true)) {
            print("Gerät wurde eingeschaltet. Setze Energiemessung zurück...");
            updateTextComponent(TEXT_LADESTATUS_ID, "Initialisiere...");
            updateTextComponent(TEXT_LADEDATEN_ID, "Berechne...");
            startEnergy = -1;
            lowPowerDurationCounter = 0;
            
            if (timerHandle !== null) Timer.clear(timerHandle);
            timerHandle = Timer.set(CHECK_INTERVAL_MS, true, checkEnergy);
        }
    }
});

// Falls das Script gestartet wird und der Stecker schon AN ist
Shelly.call("Switch.GetStatus", { id: 0 }, function (result) {
    if (result.output && timerHandle === null) {
        startEnergy = -1;
        lowPowerDurationCounter = 0;
        updateTextComponent(TEXT_LADESTATUS_ID, "Initialisiere...");
        updateTextComponent(TEXT_LADEDATEN_ID, "Berechne...");
        timerHandle = Timer.set(CHECK_INTERVAL_MS, true, checkEnergy);
    }
});
