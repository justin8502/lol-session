const { app, BrowserWindow, ipcMain } = require('electron/main');
const path = require('node:path');
const child_process = require("child_process");
const fs = require("fs");
const https = require("https");
const NodeWebSocket = require("ws");
const settings = require('electron-settings');
let ws;
let win;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

console.log('File used for Persisting Data - ' +
  settings.file());


const defaultValues = {
  defaultString: "${wins} - ${losses} \nLP: ${LPChange} \nCurrent Rank: ${currentRank} \nStarting Rank: ${sessionStartRank} \nHighest Rank: ${sessionPeakRank} \nLowest Rank: ${sessionFloorRank}",
  queueType: "RANKED_SOLO_5x5",
  storageLocation: require('path').join(require('os').homedir(), 'Desktop') + '\\LoLSession.txt'
}

const rankMap = {
  "CHALLENGER": 2800,
  "GRANDMASTER": 2800,
  "MASTER": 2800,
  "DIAMOND": 2400,
  "EMERALD": 2000,
  "PLATINUM": 1600,
  "GOLD": 1200,
  "SILVER": 800,
  "BRONZE": 400,
  "IRON": 0,
}

const divisionMap = {
  "I": 3,
  "II": 2,
  "III": 1,
  "IV": 0
}

const phaseMap = {
  "None": "",
  "Lobby": "",
  "Matchmaking": "In Queue",
  "ReadyCheck": "In Queue",
  "ChampSelect": "Champ Select",
  "GameStart": "In Game",
  "InProgress": "In Game",
  "WaitingForStats": "",
  "PreEndOfGame": "",
  "EndOfGame": "",
  "Reconnect": "In Game"
}

async function initSettings() {
  const storedString = await settings.get("defaultString");
  const storedQueue = await settings.get("queueType");
  console.log("reading values");
  console.log(storedString, storedQueue);
  if (!storedString) {
    await settings.set(defaultValues);
  }
}

function convertRankToMMR(tier, division, leaguePoints) {
  if (tier === "" || division === "NA") { return 0 };
  return rankMap[tier] + (divisionMap[division] * 100) + leaguePoints;
}

function convertRankStringToMMR(rank) {
  if (rank === "UNRANKED" || rank === "NA") { return 0 };
  const [tier, division, leaguePoints] = rank.replace(/"/g, "").replace(/'/g, "").replace(/\(|\)/g, "").split(" ");
  return rankMap[tier] + (divisionMap[division] * 100) + parseInt(leaguePoints);
}

const command = "wmic PROCESS WHERE name='LeagueClientUx.exe' GET commandline /format:list";
const command2 = "tasklist";

function LCURankUrl(port) {
  return `https://127.0.0.1:${port}/lol-ranked/v1/current-ranked-stats`;
}

function LCUEOGStatsUrl(port) {
  return `https://127.0.0.1:${port}/lol-end-of-game/v1/eog-stats-block`;
}

var wins = '0',
  losses = '0',
  LPChange = '0',
  currentRank = "NA (0 LP)",
  sessionStartRank = "NA (0 LP)",
  sessionPeakRank = "NA (0 LP)",
  sessionFloorRank = "NA (0 LP)";

let internalWins = undefined;
let internalLosses = undefined;

let didUpdateWinLoss = false;
let didInitialize = false;

String.prototype.interpolate = function (params) {
  const names = Object.keys(params);
  const vals = Object.values(params);
  return new Function(...names, `return \`${this}\`;`)(...vals);
}

function generateTextToWrite(stringToFormat, wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank) {
  console.log("Writing with the following format:" + stringToFormat);
  console.log("Variables:" + wins, losses, LPChange > 0 ? `+${LPChange}` : LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank);
  return (stringToFormat || "").interpolate({
    wins,
    losses,
    LPChange: LPChange > 0 ? `+${LPChange}` : LPChange,
    currentRank,
    sessionStartRank,
    sessionPeakRank,
    sessionFloorRank
  });
}

async function checkIfLoLRunning() {
  return new Promise((resolve, reject) => {
    child_process.exec(command2, (error, stdout, stderr) => {
      if (error || stderr) {
        resolve(false);
      }
      return resolve(stdout.toLowerCase().indexOf("LeagueClientUx.exe".toLowerCase()) > -1)
    })
  })
}

async function pullPortAndToken() {
  return new Promise((resolve, reject) => {
    child_process.exec(command, (error, stdout, stderr) => {
      // console.log(error, stdout, stderr);
      const appPortMatches = new Set(stdout.match(/--app-port=[0-9]+/g) || []);
      const authTokenMatches = new Set(stdout.match(/--remoting-auth-token=[\w-]*/g) || []);
      LCUPort = Array.from(appPortMatches)[0]?.split("=")[1];
      LCUToken = Array.from(authTokenMatches)[0]?.split("=")[1];

      resolve({
        port: LCUPort ? parseInt(LCUPort) : undefined,
        token: LCUToken && `Basic ${Buffer.from("riot:" + LCUToken).toString("base64")}`,
      });
    });
  });
}

const createWindow = () => {
  win = new BrowserWindow({
    width: 400,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      enableRemoteModule: true
    },
    icon: "./icon.png",
    autoHideMenuBar: true
  })

  win.loadFile('index.html');
}

function requestHandler(url, appToken) {
  return fetch(url, {
    headers: {
      Authorization: appToken,
    },
    agent: new https.Agent({
      rejectUnauthorized: false,
    })
  }).then((res) => {
    const json = res.json();
    console.log(json);
    return json;
  }).catch((e) => {
    console.log("request errored");
    console.log(e);
  })
}

async function attemptToPullRank(port, token, queueType) {
  try {
    json = await requestHandler(LCURankUrl(port), token);
    const [tier, division, leaguePoints] = [json["queueMap"][queueType]["tier"],
    json["queueMap"][queueType]["division"], json["queueMap"][queueType]["leaguePoints"]]
    const rankString = (tier ? tier + " " : "") + division + " (" + leaguePoints + " LP)";
    const fetchedWins = json["queueMap"][queueType]["wins"];
    const fetchedLosses = json["queueMap"][queueType]["losses"];
    if (internalWins === undefined) {
      internalWins = json["queueMap"][queueType]["wins"];
    }
    if (internalLosses === undefined) {
      internalLosses = json["queueMap"][queueType]["losses"];
    }
    rankMMR = convertRankToMMR(tier, division, leaguePoints);
    return {
      tier,
      division,
      leaguePoints,
      rankMMR,
      rankString,
      fetchedWins,
      fetchedLosses,
    }
  } catch (e) {
    console.log(e);
    return {
      tier: "",
      division: "NA",
      leaguePoints: 0,
      rankMMR: 0,
      rankString: "NA (0 LP)",
      fetchedWins: 0,
      fetchedLosses: 0,
    }
  }
}

// async function generateEOGStatsData(data) {
//   try {
//     const team1 = data["teams"][0]["players"];
//     const team2 = data["teams"][1]["players"];
//     const summonerName = data["localPlayer"]["summonerName"];
//     console.log(team1, team2, summonerName);
//   } catch (e) {
//     console.log(e);
//   }
// }

async function relayInitialToHTML() {
  const storedSettings = await settings.get();
  setTimeout(() => {
    win.webContents.send('main-send-once', storedSettings);
  }, 600);
}

async function relayLoLAPIToHTML(wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank) {
  win.webContents.send('main-send-once-lol', { wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank });
}

async function setupSources() {
  res = await pullPortAndToken();
  console.log(res);
  fetchGenerateString = await settings.get("defaultString");
  fetchLocationString = await settings.get("storageLocation");
  console.log(fetchLocationString);

  await relayInitialToHTML();
  if (res?.port && res?.token) {
    fetchQueueString = await settings.get("queueType");
    const { tier, division, leaguePoints, rankString, rankMMR } = await attemptToPullRank(res.port, res.token, fetchQueueString);
    // json = await requestHandler(LCUEOGStatsUrl(res.port), res.token);
    // console.log(json["teams"][0]["players"]);
    currentRank = rankString;
    sessionStartRank = rankString;
    sessionPeakRank = rankString;
    sessionFloorRank = rankString;
    relayLoLAPIToHTML(wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank);
    fs.writeFile(fetchLocationString, generateTextToWrite(fetchGenerateString, 0, 0, 0, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank), () => { });
    if (ws) {
      ws.close();
    }
    ws = new NodeWebSocket(`wss://127.0.0.1:${res.port}/`,
      {
        headers: {
          Authorization: res.token,
        },
        rejectUnauthorized: false
      });
    ws.on("open", () => {
      ws?.send(`[5, "OnJsonApiEvent"]`);
    })
    // console.log(ws);
    ws.on("message", async (data) => {
      const message = data.toString();
      if (!message) {
        return;
      }
      try {
        const [_opCode, _eventName, eventData] = JSON.parse(message);
        const { data, _eventType, uri } = eventData || {};
        if (uri === "/lol-gameflow/v1/session") {
          // console.log(wins, losses, LPChange);
          // console.log(data, eventType, uri);
          console.log(data?.phase);
          if (data?.phase === "EndOfGame" || data?.phase === "PreEndOfGame" || data?.phase === "WaitingForStats") {
            console.log("EndOfGame")
            fetchQueueString = await settings.get("queueType");
            const { tier, division, leaguePoints, rankString, rankMMR, fetchedWins, fetchedLosses } = await attemptToPullRank(res.port, res.token, fetchQueueString);
            const convertedMMR = currentRank && convertRankStringToMMR(currentRank);
            console.log(rankMMR, convertedMMR);
            if (rankMMR !== convertRankStringToMMR(currentRank)) {
              // Was unranked
              if (sessionStartRank === "NA (0 LP)") {
                currentRank = rankString;
                sessionStartRank = rankString;
                sessionPeakRank = rankString;
                sessionFloorRank = rankString;
              } else {
                if (convertRankStringToMMR(sessionPeakRank) < rankMMR) {
                  sessionPeakRank = rankString;
                }
                if (convertRankStringToMMR(sessionFloorRank) > rankMMR) {
                  sessionFloorRank = rankString;
                }
                LPChange = convertRankStringToMMR(rankString) - convertRankStringToMMR(sessionStartRank);
                console.log(`WINS: ${wins} LOSSES: ${losses}`);
                currentRank = rankString;
              }
              // const didWin = rankMMR > convertRankStringToMMR(currentRank);
              // if (didWin) {
              //   wins = parseInt(wins) + 1; 
              // } else {
              //   losses = parseInt(losses) + 1;
              // }
            }
            wins = fetchedWins - internalWins;
            losses = fetchedLosses - internalLosses;
            fetchGenerateString = await settings.get("defaultString");
            fetchLocationString = await settings.get("storageLocation");
            relayLoLAPIToHTML(wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank);
            fs.writeFile(fetchLocationString, generateTextToWrite(fetchGenerateString, wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank), () => { });
            // else if (!didUpdateWinLoss) {
            //   console.log("LP did not change. Attempt using end of stats block instead. ");
            //   EOGjson = await requestHandler(LCUEOGStatsUrl(res.port), res.token);
            //   if (EOGjson?.queueType === "RANKED_SOLO_5x5") {
            //     console.log(EOGjson);
            //   } else {
            //     // Not interested
            //     didUpdateWinLoss = true;
            //   }
            //   // Check using EOG stats block if loss registered. 
            }
          } else {
            didUpdateWinLoss = false;
          }
        // }
      } catch (e) {
        console.log(e);
      }

    });
  }
}

app.on("certificate-error", (event, webContents, url, error, certificate, callback, isMainFrame) => {
  event.preventDefault();
  callback(true);
})

async function driver() {

  initSettings();
  createWindow();

  let isLolRunning = await checkIfLoLRunning();
  // If LOL is running just auto grab
  if (isLolRunning) {
    setupSources();
    didInitialize = true;
  }
  setInterval(async function () {
    isLolRunning = await checkIfLoLRunning();
    if (isLolRunning && !didInitialize) {
      setTimeout(() => {
        setupSources();
      }, 6000)
      didInitialize = true;
    } else if (!isLolRunning) {
      didInitialize = false;
      await win.webContents.send('main-send-connection-reset', defaultValues);
    }
  }, 5000);
}

app.whenReady().then(async () => {
  driver();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      driver();
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('electronStoreGet', async (event, val) => {
  event.returnValue = store.get(val);
});

ipcMain.handle('electronStoreSet', async (event, data) => {
  settings.set("defaultString", data["defaultString"]);
  console.log(data);
  const locationString = await settings.get("storageLocation");
  fs.writeFile(locationString, generateTextToWrite(
    data.defaultString,
    wins,
    losses,
    LPChange,
    currentRank,
    sessionStartRank,
    sessionPeakRank,
    sessionFloorRank), () => { });
});

ipcMain.handle('updateStorageLocation', async (event, data) => {
  await settings.set("storageLocation", data);
  const locationString = await settings.get("storageLocation");
  const defaultString = await settings.get("defaultString");
  fs.writeFile(locationString, generateTextToWrite(
    defaultString,
    wins,
    losses,
    LPChange,
    currentRank,
    sessionStartRank,
    sessionPeakRank,
    sessionFloorRank), () => { });
});

ipcMain.handle('updateValues', async (event, data) => {
  internalWins = internalWins - (data["wins"] - wins);
  internalLosses = internalLosses - (data["losses"] - losses);
  wins = data["wins"];
  losses = data["losses"];
  LPChange = data["LPChange"];
  currentRank = data["currentRank"];
  sessionStartRank = data["sessionStartRank"];
  sessionPeakRank = data["sessionPeakRank"];
  sessionEndRank = data["sessionEndRank"];
  const locationString = await settings.get("storageLocation");
  const defaultString = await settings.get("defaultString");
  fs.writeFile(locationString, generateTextToWrite(
    defaultString,
    wins,
    losses,
    LPChange,
    currentRank,
    sessionStartRank,
    sessionPeakRank,
    sessionFloorRank), () => { });
});

ipcMain.handle('reset', async (event, data) => {
  await settings.set(defaultValues);
  await win.webContents.send('main-send-text-reset', defaultValues);
  resetAllVariables();
});

ipcMain.handle('updateQueue', async (event, data) => {
  await settings.set("queueType", data);
  resetAllVariables();
});

async function resetAllVariables() {
  fetchQueueString = await settings.get("queueType");
  fetchGenerateString = await settings.get("defaultString");
  res = await pullPortAndToken();
  if (res?.port && res?.token) {
    const { tier, division, leaguePoints, rankString, rankMMR, fetchedWins, fetchedLosses } = await attemptToPullRank(res.port, res.token, fetchQueueString);
    currentRank = rankString;
    sessionStartRank = rankString;
    sessionPeakRank = rankString;
    sessionFloorRank = rankString;
    internalWins = fetchedWins;
    internalLosses = fetchedLosses;
  } else {
    currentRank = "NA";
    sessionStartRank = "NA";
    sessionPeakRank = "NA";
    sessionFloorRank = "NA";
    internalWins = undefined;
    internalLosses = undefined;
  }
  wins = 0;
  losses = 0;
  LPChange = 0;
  fs.writeFile(fetchLocationString, generateTextToWrite(fetchGenerateString, wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank), () => { });
  relayLoLAPIToHTML(wins, losses, LPChange, currentRank, sessionStartRank, sessionPeakRank, sessionFloorRank);
}