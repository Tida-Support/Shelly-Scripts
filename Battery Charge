// CONFIGURATION - BATTERY & FIXED VALUES
const CHARGING_LOSS_PERCENT = 20;  // Typical charger loss (usually between 10% and 20%)
const BATT_CAPACITY_WH = 625;      // Nominal capacity of the battery in Wh
const BATT_HEALTH_PERCENT = 90;    // Current State of Health (SoH) of the battery in %

// CONFIGURATION - SLIDER & TEXT IDs (Please adjust to your Shelly IDs!)
const SLIDER_START_SOC_ID = "number:200";     // ID of the slider component for "Battery Start SoC"
const SLIDER_TARGET_SOC_ID = "number:201";    // ID of the slider component for "Battery Target SoC"
const TEXT_CURRENT_SOC_ID = "text:200";       // ID of the text component for "Current SoC"
const TEXT_CHARGE_DATA_ID = "text:201";       // ID of the text component for "Charging Data"
const TEXT_CHARGE_STATUS_ID = "text:202";     // ID of the text component for "Charging Status" + Time remaining

// CONFIGURATION - ADDITIONAL POWER SAFETY (AUTO-OFF)
const MIN_POWER_WATT = 75.0;       // If power drops below this Watt threshold...
const MIN_POWER_DURATION_SEC = 60; // ...and stays there for X seconds, it shuts down.

const CHECK_INTERVAL_MS = 2000;   // Checks every 2 seconds

// Global variables for tracking
let startEnergy = -1;
let timerHandle = null;
let lowPowerDurationCounter = 0;

// Helper function to update text components
function updateTextComponent(componentId, textValue) {
    Shelly.call("Text.Set", { id: componentId.split(":")[1], value: textValue }, function(res, err, msg) {
        if (err !== 0) {
            print("Error updating " + componentId + ": " + msg);
        }
    });
}

// Helper function to format the remaining time
function formatRemainingTime(currentPower, remainingWh) {
    if (currentPower <= 5) { // If there is little or no power draw
        return "--h --m";
    }
    // Time in hours = remaining Wh / current power in Watts
    let hoursTotal = remainingWh / currentPower;
    let hours = Math.floor(hoursTotal);
    let minutes = Math.floor((hoursTotal - hours) * 60);
    
    return hours + "h " + minutes + "m";
}

function checkEnergy() {
    // 1. Get switch status
    Shelly.call("Switch.GetStatus", { id: 0 }, function (switchResult, error_code, error_message) {
        if (error_code !== 0 || !switchResult.output) {
            if (timerHandle !== null) {
                print("Plug is off. Monitoring paused.");
                Timer.clear(timerHandle);
                timerHandle = null;
                startEnergy = -1;
                lowPowerDurationCounter = 0;
                updateTextComponent(TEXT_CURRENT_SOC_ID, "0.0 %");
                updateTextComponent(TEXT_CHARGE_DATA_ID, "0.0 / 0.0 Wh | 0 W");
                updateTextComponent(TEXT_CHARGE_STATUS_ID, "Inactive / Off");
            }
            return;
        }

        // 2. Get value of the start slider
        Shelly.call("Number.GetStatus", { id: SLIDER_START_SOC_ID.split(":")[1] }, function (startSlider) {
            // 3. Get value of the target slider
            Shelly.call("Number.GetStatus", { id: SLIDER_TARGET_SOC_ID.split(":")[1] }, function (targetSlider) {
                
                let startSoC = startSlider ? startSlider.value : 79; 
                let targetSoC = targetSlider ? targetSlider.value : 85;    

                // DYNAMIC CALCULATION OF THE WH LIMIT
                let realCapacityWh = BATT_CAPACITY_WH * (BATT_HEALTH_PERCENT / 100);
                let percentToCharge = targetSoC - startSoC;
                let netWhToCharge = realCapacityWh * (percentToCharge / 100);
                let energyLimitWh = netWhToCharge * (1 + (CHARGING_LOSS_PERCENT / 100));

                if (energyLimitWh <= 0) {
                    print("WARNING: Target already reached or lower than start!");
                    shutdown("Error: Target reached", "0.0 / 0.0 Wh | 0 W");
                    return;
                }

                let currentTotalEnergy = switchResult.aenergy.total;
                let currentPowerWatt = switchResult.apower;

                // First run after turning on: Set the starting energy
                if (startEnergy === -1) {
                    startEnergy = currentTotalEnergy;
                    print("--- CHARGING MONITORING STARTED ---");
                    
                    updateTextComponent(TEXT_CURRENT_SOC_ID, startSoC.toFixed(1) + " %");
                    updateTextComponent(TEXT_CHARGE_DATA_ID, "0.0 / " + energyLimitWh.toFixed(1) + " Wh | " + currentPowerWatt.toFixed(1) + " W");
                    updateTextComponent(TEXT_CHARGE_STATUS_ID, "Initializing charge...");
                    return;
                }

                let consumedWh = currentTotalEnergy - startEnergy;
                let chargedNetWh = consumedWh / (1 + (CHARGING_LOSS_PERCENT / 100));
                let estimatedCurrentSoC = startSoC + (chargedNetWh / realCapacityWh) * 100;
                if (estimatedCurrentSoC > targetSoC) estimatedCurrentSoC = targetSoC;

                // CALCULATE REMAINING TIME
                let remainingWh = energyLimitWh - consumedWh;
                if (remainingWh < 0) remainingWh = 0;
                let remainingTimeStr = formatRemainingTime(currentPowerWatt, remainingWh);

                // --- POPULATE TEXT COMPONENTS ---
                updateTextComponent(TEXT_CURRENT_SOC_ID, estimatedCurrentSoC.toFixed(1) + " %");
                
                let statsMsg = consumedWh.toFixed(1) + " / " + energyLimitWh.toFixed(1) + " Wh | " + currentPowerWatt.toFixed(1) + " W";
                updateTextComponent(TEXT_CHARGE_DATA_ID, statsMsg);

                print("Measured: " + consumedWh.toFixed(1) + " Wh / " + energyLimitWh.toFixed(1) + " Wh (~" + estimatedCurrentSoC.toFixed(1) + "%) | Time remaining: " + remainingTimeStr + " | Load: " + currentPowerWatt.toFixed(1) + " W");

                // --- CHECK 1: Minimum power dropped? ---
                if (currentPowerWatt < MIN_POWER_WATT) {
                    lowPowerDurationCounter += (CHECK_INTERVAL_MS / 1000);
                    let remainingSec = MIN_POWER_DURATION_SEC - lowPowerDurationCounter;
                    
                    print("-> Low power detected! Shutting down in " + remainingSec.toFixed(0) + "s");
                    updateTextComponent(TEXT_CHARGE_STATUS_ID, "Low power! Standby in " + remainingSec.toFixed(0) + "s");
                    
                    if (lowPowerDurationCounter >= MIN_POWER_DURATION_SEC) {
                        print("SAFETY SHUTDOWN: Power too low for too long.");
                        shutdown("Auto-Off: Fully charged / Standby", statsMsg);
                        return;
                    }
                } else {
                    if (lowPowerDurationCounter > 0) {
                        lowPowerDurationCounter = 0;
                    }
                    updateTextComponent(TEXT_CHARGE_STATUS_ID, "Charging... Approx. " + remainingTimeStr + " left");
                }

                // --- CHECK 2: Wh limit reached? ---
                if (consumedWh >= energyLimitWh) {
                    print("TARGET REACHED: Turning off...");
                    shutdown("Target reached: " + targetSoC + "%", statsMsg);
                }
            });
        });
    });
}

// Revised shutdown function with clean distribution to all fields
function shutdown(logReason, finalStats) {
    print("shutdown() called due to: " + logReason);

    // 1. Delete timer IMMEDIATELY
    if (timerHandle !== null) {
        Timer.clear(timerHandle);
        timerHandle = null;
    }
    
    // 2. Reset variables
    startEnergy = -1;
    lowPowerDurationCounter = 0;

    // 3. Turn off switch (Highest priority to protect the relay)
    Shelly.call("Switch.Set", { id: 0, on: false }, function(res, err, msg) {
        if (err !== 0) {
            print("ERROR while turning off: " + msg);
        }
        
        // 4. Update dashboard fields after shutdown
        updateTextComponent(TEXT_CURRENT_SOC_ID, "0.0 %");
        if (finalStats) updateTextComponent(TEXT_CHARGE_DATA_ID, finalStats);
        if (logReason) updateTextComponent(TEXT_CHARGE_STATUS_ID, logReason);
    });
}

// Event Listener: Detects when the device is switched on
Shelly.addEventHandler(function (event) {
    if (event.component === "switch:0") {
        if (event.info.output === true || (event.info.event === "toggle" && event.info.state === true)) {
            print("Device turned on. Resetting energy measurement...");
            updateTextComponent(TEXT_CHARGE_STATUS_ID, "Initializing...");
            updateTextComponent(TEXT_CHARGE_DATA_ID, "Calculating...");
            startEnergy = -1;
            lowPowerDurationCounter = 0;
            
            if (timerHandle !== null) Timer.clear(timerHandle);
            timerHandle = Timer.set(CHECK_INTERVAL_MS, true, checkEnergy);
        }
    }
});

// If the script is started and the plug is already ON
Shelly.call("Switch.GetStatus", { id: 0 }, function (result) {
    if (result.output && timerHandle === null) {
        startEnergy = -1;
        lowPowerDurationCounter = 0;
        updateTextComponent(TEXT_CHARGE_STATUS_ID, "Initializing...");
        updateTextComponent(TEXT_CHARGE_DATA_ID, "Calculating...");
        timerHandle = Timer.set(CHECK_INTERVAL_MS, true, checkEnergy);
    }
});
