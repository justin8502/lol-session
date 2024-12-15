document.getElementById("update-button").addEventListener("click", function () {
  // Code to execute when the button is clicked
  console.log("Button clicked!");
  window.api.invoke("updateValues", {
    wins: document.getElementById("wins").value,
    losses: document.getElementById("losses").value,
    LPChange: document.getElementById("lp-change").value,
    currentRank: document.getElementById("current-rank").value,
    sessionStartRank: document.getElementById("session-start-rank").value,
    sessionPeakRank: document.getElementById("session-peak-rank").value,
    sessionFloorRank: document.getElementById("session-low-rank").value,
  });
});

document.getElementById("formatter").addEventListener("input", function(event) {
  let defaultString = document.getElementById("formatter").value;
  window.api.invoke("electronStoreSet", {
    defaultString: defaultString
  });
});

document.getElementById("queue-type").addEventListener("change", function(event) {
  window.api.invoke("updateQueue", event.target.value);
});

document.getElementById("reset-button").addEventListener("click", function(event) {
  window.api.invoke("reset");
});

document.getElementById("output-location").addEventListener("click", function(e) {
  const newPath = document.getElementById("output-location-raw").value.replace(/'/g, "\\'");
  document.getElementById("output-pathname").innerText = newPath;
  window.api.invoke("updateStorageLocation", newPath);
});

window.api.mainSendOnce((value) => {
  document.getElementById("output-pathname").innerText = value["storageLocation"];
  document.getElementById("formatter").value = value["defaultString"];
  document.getElementById("queue-type").value = value["queueType"];
  
  document.getElementById("output-location-raw").value = value["storageLocation"];
})

window.api.mainSendOnceLoL((value) => {
  document.getElementById("status-message").innerText = "CONNECTED";
  document.getElementById("wins").value = value["wins"];
  document.getElementById("losses").value = value["losses"];
  document.getElementById("lp-change").value = value["LPChange"];
  document.getElementById("current-rank").value = value["currentRank"];
  document.getElementById("session-start-rank").value = value["sessionStartRank"];
  document.getElementById("session-peak-rank").value = value["sessionPeakRank"];
  document.getElementById("session-low-rank").value = value["sessionFloorRank"];
})

window.api.mainSendTextReset((value) => {
  document.getElementById("formatter").value = value["defaultString"];
  document.getElementById("output-pathname").innerText = value["storageLocation"];
  document.getElementById("output-location-raw").value = value["storageLocation"];
})

window.api.mainSendConnectionReset((value) => {
  document.getElementById("status-message").innerText = "NOT CONNECTED";
})