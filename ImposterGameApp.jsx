import React, { useEffect, useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";


// Firebase real-time networked Imposter-like game (single-file React component).
// This version includes a robust check for Firebase Realtime Database configuration
// and will not attempt to use the database unless the firebaseConfig is filled.
// Usage:
// 1) Install dependencies: npm i firebase uuid
// 2) Create a Firebase project, enable Realtime Database.
// 3) Replace the firebaseConfig object below with your project's config (especially databaseURL).
// 4) For quick testing set DB rules to allow reads/writes (dev only):
//    { "rules": { ".read": true, ".write": true } }
// 5) Drop this file into a Create-React-App project as App.jsx (or import it).

import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update as firebaseUpdate,
  get,
  child,
  runTransaction,
  remove,
} from "firebase/database";

// === REPLACE THIS WITH YOUR FIREBASE CONFIG ===
// IMPORTANT: Make sure databaseURL is set to the Realtime Database URL for your project.
// Example databaseURL: "https://your-project-id-default-rtdb.firebaseio.com"
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "impostergame-ffd6d.firebaseapp.com",
  databaseURL: "https://impostergame-ffd6d-default-rtdb.firebaseio.com/", // important for Realtime Database
  projectId: "impostergame-ffd6d",
  storageBucket: "impostergame-ffd6d.appspot.com",
  messagingSenderId: "602086265838",
  appId: "1:602086265838:web:24c2f7cb1019dd50a574ff",
};
// ==============================================

// Helper: validate whether the firebaseConfig looks filled-out.
function isConfigFilled(cfg) {
  if (!cfg) return false;
  const required = ["apiKey", "databaseURL", "projectId", "appId"];
  for (const k of required) {
    if (!cfg[k] || typeof cfg[k] !== "string") return false;
    if (cfg[k].includes("REPLACE_ME") || cfg[k].trim() === "") return false;
  }
  // basic check that databaseURL looks like an https URL
  try {
    const url = new URL(cfg.databaseURL);
    if (!url.protocol.startsWith("http")) return false;
  } catch (e) {
    return false;
  }
  return true;
}

let firebaseApp = null;
let db = null;
let firebaseConfigured = isConfigFilled(firebaseConfig);
if (firebaseConfigured) {
  try {
    firebaseApp = initializeApp(firebaseConfig);
    // getDatabase can throw if the SDK cannot access database service (e.g. misconfigured)
    db = getDatabase(firebaseApp);
  } catch (err) {
    console.error("Failed to initialize Firebase Realtime Database:", err);
    firebaseConfigured = false;
    db = null;
  }
} else {
  console.warn("Firebase configuration is not set. Please replace the firebaseConfig object with your project's values.");
}

export default function App() {
  const [meId] = useState(() => localStorage.getItem("imposter_meId") || uuidv4());
  const [name, setName] = useState(() => localStorage.getItem("imposter_name") || "");
  const [rooms, setRooms] = useState({});
  const [currentRoomCode, setCurrentRoomCode] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [configOk, setConfigOk] = useState(firebaseConfigured);
  const hintRef = useRef();

  useEffect(() => localStorage.setItem("imposter_meId", meId), [meId]);
  useEffect(() => localStorage.setItem("imposter_name", name), [name]);

  // Listen to rooms list in realtime (only if DB configured)
  useEffect(() => {
    if (!configOk || !db) {
      setRooms({});
      return; // no DB available
    }
    const roomsRef = ref(db, "rooms");
    const unsubscribe = onValue(roomsRef, (snapshot) => {
      const val = snapshot.val() || {};
      setRooms(val);
    }, (err) => {
      console.error("Realtime subscription error:", err);
      // on any error, mark config not ok so UI can show instructions
      setConfigOk(false);
    });
    return () => {
      try { unsubscribe(); } catch (e) { /* ignore */ }
    };
  }, [configOk]);

  function makeCode() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  async function createRoom() {
    if (!name.trim()) return alert("Enter a display name first.");
    if (!configOk || !db) return alert("Firebase is not configured. Please set firebaseConfig with your project's settings.");

    let code = makeCode();
    // ensure uniqueness (run small loop if collision)
    for (let i = 0; i < 6; i++) {
      const snap = await get(child(ref(db), `rooms/${code}`));
      if (!snap.exists()) break;
      code = makeCode();
    }

    const room = {
      code,
      leaderId: meId,
      impostersCount: 1,
      started: false,
      turnIndex: 0,
      players: {
        [meId]: { id: meId, name: name.trim(), role: "crewmate", joinedAt: Date.now() },
      },
      chat: {},
      createdAt: Date.now(),
    };

    await set(ref(db, `rooms/${code}`), room);
    setCurrentRoomCode(code);
  }

  async function joinRoom(code) {
    if (!name.trim()) return alert("Enter a display name first.");
    if (!configOk || !db) return alert("Firebase is not configured. Please set firebaseConfig with your project's settings.");

    code = code.toUpperCase();
    const roomRef = ref(db, `rooms/${code}`);
    const snap = await get(roomRef);
    if (!snap.exists()) return alert("That room code doesn't exist.");
    const room = snap.val();
    if (room.started) return alert("Game already started.");

    // use transaction to avoid race conditions when multiple people join
    await runTransaction(ref(db, `rooms/${code}/players`), (players) => {
      if (!players) players = {};
      if (!players[meId]) {
        players[meId] = { id: meId, name: name.trim(), role: "crewmate", joinedAt: Date.now() };
      }
      return players;
    });

    setCurrentRoomCode(code);
  }

  async function leaveRoom() {
    if (!currentRoomCode) return;
    if (!configOk || !db) {
      // Local cleanup if not connected to DB
      setCurrentRoomCode("");
      return;
    }
    const code = currentRoomCode;
    // remove the player
    await runTransaction(ref(db, `rooms/${code}/players`), (players) => {
      if (!players) return players;
      delete players[meId];
      return players;
    });

    // possible leader promotion or room cleanup
    const roomSnap = await get(ref(db, `rooms/${code}`));
    if (!roomSnap.exists()) {
      setCurrentRoomCode("");
      return;
    }
    const room = roomSnap.val();
    const playerIds = room.players ? Object.keys(room.players) : [];
    if (room.leaderId === meId) {
      if (playerIds.length > 0) {
        // promote first remaining player
        const newLeader = playerIds[0];
        await firebaseUpdate(ref(db, `rooms/${code}`), { leaderId: newLeader });
      } else {
        // delete room
        await remove(ref(db, `rooms/${code}`));
      }
    }

    setCurrentRoomCode("");
  }

  async function setImposterCount(code, count) {
    if (!configOk || !db) return alert("Firebase is not configured. Please set firebaseConfig with your project's settings.");
    const snap = await get(ref(db, `rooms/${code}/players`));
    const players = snap.exists() ? Object.keys(snap.val()) : [];
    const safe = Math.max(1, Math.min(count || 1, players.length || 1));
    await firebaseUpdate(ref(db, `rooms/${code}`), { impostersCount: safe });
  }

  async function startGame(code) {
    if (!configOk || !db) return alert("Firebase is not configured. Please set firebaseConfig with your project's settings.");
    const roomSnap = await get(ref(db, `rooms/${code}`));
    if (!roomSnap.exists()) return;
    const room = roomSnap.val();
    const players = room.players ? Object.values(room.players) : [];
    if (players.length === 0) return;
    const numImposters = Math.min(room.impostersCount || 1, Math.max(1, Math.floor(players.length / 2)));
    const shuffled = players.slice().sort(() => Math.random() - 0.5);
    const imposterIds = shuffled.slice(0, numImposters).map((p) => p.id);

    // write roles and set started
    const updates = {};
    players.forEach((p) => {
      updates[`rooms/${code}/players/${p.id}/role`] = imposterIds.includes(p.id) ? "imposter" : "crewmate";
    });
    updates[`rooms/${code}/started`] = true;
    updates[`rooms/${code}/turnIndex`] = 0;
    const msgKey = `rooms/${code}/chat/${Date.now()}`;
    updates[msgKey] = { system: true, text: `Game started. ${numImposters} imposters assigned.`, ts: Date.now() };

    await firebaseUpdate(ref(db), updates);
  }

  async function sendHint(text) {
    if (!configOk || !db) return alert("Firebase is not configured. Please set firebaseConfig with your project's settings.");
    const code = currentRoomCode;
    if (!code) return;
    const roomSnap = await get(ref(db, `rooms/${code}`));
    if (!roomSnap.exists()) return;
    const room = roomSnap.val();
    const playerIds = room.players ? Object.keys(room.players) : [];
    if (playerIds.length === 0) return;
    const currentPlayerId = playerIds[room.turnIndex % playerIds.length];
    if (currentPlayerId !== meId) return alert("It's not your turn.");

    const chatKey = `rooms/${code}/chat/${Date.now()}`;
    const nextTurn = (room.turnIndex + 1) % playerIds.length;
    const updates = {};
    updates[chatKey] = { playerId: meId, name: name.trim(), text: text.trim(), ts: Date.now() };
    updates[`rooms/${code}/turnIndex`] = nextTurn;
    await firebaseUpdate(ref(db), updates);
  }

  async function kickPlayer(playerId) {
    if (!currentRoomCode) return;
    if (!configOk || !db) return alert("Firebase is not configured. Please set firebaseConfig with your project's settings.");
    const code = currentRoomCode;
    // only leader can kick (client-side check)
    const roomSnap = await get(ref(db, `rooms/${code}`));
    if (!roomSnap.exists()) return;
    const room = roomSnap.val();
    if (room.leaderId !== meId) return alert("Only leader can kick players.");

    await runTransaction(ref(db, `rooms/${code}/players`), (players) => {
      if (!players) return players;
      delete players[playerId];
      return players;
    });
  }

  // Render helpers similar to previous local version but read live data from `rooms` state.
  function renderLobby(room) {
    const amLeader = room.leaderId === meId;
    const playerList = room.players ? Object.values(room.players) : [];
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Room {room.code}</h2>
            <p className="text-sm">Leader: {playerList.find((p) => p.id === room.leaderId)?.name || "-"}</p>
            <p className="text-sm">Imposters: {room.impostersCount}</p>
          </div>
          <div>
            <button className="px-3 py-1 rounded bg-gray-200" onClick={leaveRoom}>Leave</button>
          </div>
        </div>

        <div className="bg-white rounded shadow p-3">
          <h3 className="font-semibold">Players ({playerList.length})</h3>
          <ul className="mt-2 space-y-1">
            {playerList.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  {p.id === meId ? <span className="ml-2 text-xs text-blue-600">(you)</span> : null}
                  {p.id === room.leaderId ? <span className="ml-2 text-xs">(leader)</span> : null}
                </div>
                {amLeader && p.id !== meId ? (
                  <div>
                    <button className="text-sm px-2 py-1 rounded bg-red-100" onClick={() => kickPlayer(p.id)}>Kick</button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {amLeader && !room.started && (
          <div className="space-y-2">
            <label className="block text-sm">Set number of imposters</label>
            <input type="number" min={1} max={Math.max(1, playerList.length)} value={room.impostersCount}
              onChange={(e) => setImposterCount(room.code, parseInt(e.target.value || "1", 10))}
              className="w-24 p-1 rounded border" />
            <div>
              <button className="px-3 py-2 rounded bg-green-400" onClick={() => startGame(room.code)}>Start Game</button>
            </div>
          </div>
        )}

        {room.started && renderGame(room)}
      </div>
    );
  }

  function renderGame(room) {
    const playerList = room.players ? Object.values(room.players) : [];
    const mePlayer = playerList.find((p) => p.id === meId) || {};
    const currentPlayer = playerList.length ? playerList[room.turnIndex % playerList.length] : null;

    const chatEntries = room.chat ? Object.values(room.chat).sort((a,b)=>a.ts - b.ts) : [];

    return (
      <div className="space-y-3">
        <div className="bg-white rounded shadow p-3">
          <div className="flex justify-between">
            <div>
              <div className="text-sm">Your role: <strong>{mePlayer.role || 'unknown'}</strong></div>
              <div className="text-sm">Turn: <strong>{currentPlayer?.name}</strong></div>
            </div>
            <div className="text-sm">Players left: {playerList.length}</div>
          </div>
        </div>

        <div className="bg-white rounded shadow p-3 max-h-60 overflow-auto">
          <h4 className="font-semibold">Chat</h4>
          <div className="mt-2 space-y-2">
            {chatEntries.map((m, idx) => (
              <div key={idx} className={`p-2 rounded ${m.system ? 'bg-gray-100' : (m.playerId === meId ? 'bg-blue-50' : 'bg-gray-50')}`}>
                {m.system ? (
                  <em className="text-sm">{m.text}</em>
                ) : (
                  <div>
                    <strong>{m.name}</strong>: <span>{m.text}</span>
                    <div className="text-xs text-gray-400">{new Date(m.ts).toLocaleTimeString()}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          {currentPlayer?.id === meId ? (
            <div className="flex gap-2">
              <input ref={hintRef} placeholder="Type your hint and press Enter" onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = e.target.value;
                  if (v.trim()) {
                    sendHint(v);
                    e.target.value = '';
                  }
                }
              }} className="flex-1 p-2 rounded border" />
              <button className="px-3 py-2 rounded bg-blue-400" onClick={() => {
                const v = hintRef.current.value;
                if (v.trim()) {
                  sendHint(v);
                  hintRef.current.value = '';
                }
              }}>Send</button>
            </div>
          ) : (
            <div className="p-2 text-sm">Waiting for <strong>{currentPlayer?.name}</strong> to give a hint...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Imposter — Hint Party (Firebase)</h1>
          <div className="text-sm text-gray-600">Open on multiple devices and join with the room code</div>
        </header>

        <main className="bg-gray-100 p-6 rounded shadow">
          {!currentRoomCode ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input placeholder="Your display name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1 p-2 rounded border" />
                <button className="px-3 py-2 rounded bg-indigo-400 text-white" onClick={createRoom}>Create Room</button>
              </div>

              <div className="flex gap-2 items-center">
                <input placeholder="Join code" value={joinCodeInput} onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())} className="p-2 rounded border w-36" />
                <button className="px-3 py-2 rounded bg-green-400" onClick={() => joinRoom(joinCodeInput)}>Join</button>
              </div>

              <div>
                <h4 className="font-semibold">Active Rooms (click to join)</h4>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {Object.values(rooms).filter(r=>!r.started).length === 0 ? (
                    <div className="text-sm text-gray-500">No open rooms yet</div>
                  ) : (
                    Object.values(rooms).filter(r=>!r.started).map((r) => (
                      <div key={r.code} className="p-3 bg-white rounded shadow flex items-center justify-between">
                        <div>
                          <div className="font-medium">{r.code}</div>
                          <div className="text-sm text-gray-500">Players: {r.players ? Object.keys(r.players).length : 0} — Leader: {r.players ? Object.values(r.players).find(p=>p.id===r.leaderId)?.name : '-'}{r.started ? ' (started)' : ''}</div>
                        </div>
                        <div>
                          <button className="px-2 py-1 rounded bg-blue-100" onClick={() => joinRoom(r.code)}>Join</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          ) : (
            rooms[currentRoomCode] ? renderLobby(rooms[currentRoomCode]) : (
              <div>
                <p>Room not found (it may have been closed).</p>
                <button className="px-3 py-1 rounded bg-gray-200" onClick={() => setCurrentRoomCode("")}>Back</button>
              </div>
            )
          )}
        </main>

        <footer className="mt-4 text-xs text-gray-500">
          This version uses Firebase Realtime Database. For production use, secure your database with proper rules and consider using Firebase Auth.
        </footer>
      </div>
    </div>
  );
}
