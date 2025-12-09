import React, { useEffect, useState, useRef } from "react";
import { v4 as uuidv4 } from "uuid";

// Single-file React app for a local-demo multiplayer Imposter-like game.
// Works across browser tabs by syncing rooms through localStorage and the "storage" event.
// Usage: drop this into a Create-React-App project as App.jsx (install uuid: npm i uuid).

export default function App() {
  const [meId] = useState(() => localStorage.getItem("imposter_meId") || uuidv4());
  const [name, setName] = useState("");
  const [rooms, setRooms] = useState(() => JSON.parse(localStorage.getItem("imposter_rooms") || "{}"));
  const [currentRoomCode, setCurrentRoomCode] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [isLeaderView, setIsLeaderView] = useState(false);
  const hintRef = useRef();

  // persist my id
  useEffect(() => {
    localStorage.setItem("imposter_meId", meId);
  }, [meId]);

  // listen for localStorage changes to sync rooms across tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key === "imposter_rooms") {
        setRooms(JSON.parse(e.newValue || "{}"));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // helper: save rooms to localStorage
  function saveRooms(next) {
    localStorage.setItem("imposter_rooms", JSON.stringify(next));
    setRooms(next);
  }

  function makeCode() {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // avoid ambiguous chars
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function createRoom() {
    if (!name.trim()) return alert("Enter a display name first.");
    let code = makeCode();
    const roomsCopy = { ...rooms };
    while (roomsCopy[code]) code = makeCode();

    const room = {
      code,
      leaderId: meId,
      impostersCount: 1,
      started: false,
      turnIndex: 0,
      players: [
        { id: meId, name: name.trim(), role: "crewmate", joinedAt: Date.now() },
      ],
      chat: [],
      createdAt: Date.now(),
    };
    roomsCopy[code] = room;
    saveRooms(roomsCopy);
    setCurrentRoomCode(code);
    setIsLeaderView(true);
  }

  function joinRoom(code) {
    if (!name.trim()) return alert("Enter a display name first.");
    const roomsCopy = { ...rooms };
    const room = roomsCopy[code];
    if (!room) return alert("That room code doesn't exist.");
    if (room.started) return alert("Game already started.");
    if (room.players.find((p) => p.id === meId)) {
      setCurrentRoomCode(code);
      setIsLeaderView(room.leaderId === meId);
      return;
    }
    room.players.push({ id: meId, name: name.trim(), role: "crewmate", joinedAt: Date.now() });
    roomsCopy[code] = room;
    saveRooms(roomsCopy);
    setCurrentRoomCode(code);
    setIsLeaderView(room.leaderId === meId);
  }

  function leaveRoom() {
    if (!currentRoomCode) return;
    const roomsCopy = { ...rooms };
    const room = roomsCopy[currentRoomCode];
    if (!room) return setCurrentRoomCode("");
    room.players = room.players.filter((p) => p.id !== meId);
    // if leader left, promote first player or delete room
    if (room.leaderId === meId) {
      if (room.players.length > 0) {
        room.leaderId = room.players[0].id;
      } else {
        delete roomsCopy[currentRoomCode];
        saveRooms(roomsCopy);
        setCurrentRoomCode("");
        return;
      }
    }
    roomsCopy[currentRoomCode] = room;
    saveRooms(roomsCopy);
    setCurrentRoomCode("");
  }

  function updateRoom(code, patch) {
    const roomsCopy = { ...rooms };
    const room = roomsCopy[code];
    if (!room) return;
    Object.assign(room, patch);
    roomsCopy[code] = room;
    saveRooms(roomsCopy);
  }

  function setImposterCount(code, count) {
    const room = rooms[code];
    if (!room) return;
    updateRoom(code, { impostersCount: Math.max(1, Math.min(count, Math.floor(room.players.length / 1) )) });
  }

  function startGame(code) {
    const roomsCopy = { ...rooms };
    const room = roomsCopy[code];
    if (!room) return;
    const players = [...room.players];
    const numImposters = Math.min(room.impostersCount, Math.max(1, Math.floor(players.length / 2)));
    // randomly select imposters
    const shuffled = players.slice().sort(() => Math.random() - 0.5);
    const imposterIds = new Set(shuffled.slice(0, numImposters).map((p) => p.id));
    players.forEach((p) => (p.role = imposterIds.has(p.id) ? "imposter" : "crewmate"));
    room.players = players;
    room.started = true;
    room.turnIndex = 0;
    room.chat = room.chat || [];
    room.chat.push({ system: true, text: `Game started. ${numImposters} imposters assigned.`, ts: Date.now() });
    roomsCopy[code] = room;
    saveRooms(roomsCopy);
  }

  function sendHint(text) {
    const roomsCopy = { ...rooms };
    const room = roomsCopy[currentRoomCode];
    if (!room) return;
    const currentPlayer = room.players[room.turnIndex % room.players.length];
    if (!currentPlayer || currentPlayer.id !== meId) return alert("It's not your turn.");
    room.chat.push({ playerId: meId, name: name.trim(), text: text.trim(), ts: Date.now() });
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    roomsCopy[currentRoomCode] = room;
    saveRooms(roomsCopy);
  }

  function kickPlayer(playerId) {
    if (!currentRoomCode) return;
    const roomsCopy = { ...rooms };
    const room = roomsCopy[currentRoomCode];
    if (!room) return;
    room.players = room.players.filter((p) => p.id !== playerId);
    if (room.leaderId === playerId) {
      room.leaderId = room.players.length ? room.players[0].id : null;
    }
    roomsCopy[currentRoomCode] = room;
    saveRooms(roomsCopy);
  }

  // UI helpers
  function renderLobby(room) {
    const amLeader = room.leaderId === meId;
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Room {room.code}</h2>
            <p className="text-sm">Leader: {room.players.find((p) => p.id === room.leaderId)?.name || "-"}</p>
            <p className="text-sm">Imposters: {room.impostersCount}</p>
          </div>
          <div>
            <button className="px-3 py-1 rounded bg-gray-200" onClick={leaveRoom}>Leave</button>
          </div>
        </div>

        <div className="bg-white rounded shadow p-3">
          <h3 className="font-semibold">Players ({room.players.length})</h3>
          <ul className="mt-2 space-y-1">
            {room.players.map((p) => (
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
            <input type="number" min={1} max={Math.max(1, room.players.length - 1)} value={room.impostersCount}
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
    const mePlayer = room.players.find((p) => p.id === meId);
    const currentPlayer = room.players[room.turnIndex % room.players.length];
    return (
      <div className="space-y-3">
        <div className="bg-white rounded shadow p-3">
          <div className="flex justify-between">
            <div>
              <div className="text-sm">Your role: <strong>{mePlayer?.role}</strong></div>
              <div className="text-sm">Turn: <strong>{currentPlayer?.name}</strong></div>
            </div>
            <div className="text-sm">Players left: {room.players.length}</div>
          </div>
        </div>

        <div className="bg-white rounded shadow p-3 max-h-60 overflow-auto">
          <h4 className="font-semibold">Chat</h4>
          <div className="mt-2 space-y-2">
            {room.chat.map((m, idx) => (
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

  // app shell
  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Imposter — Hint Party (Demo)</h1>
          <div className="text-sm text-gray-600">Open in multiple tabs to simulate players</div>
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
                  {Object.values(rooms).length === 0 ? (
                    <div className="text-sm text-gray-500">No rooms yet</div>
                  ) : (
                    Object.values(rooms).map((r) => (
                      <div key={r.code} className="p-3 bg-white rounded shadow flex items-center justify-between">
                        <div>
                          <div className="font-medium">{r.code}</div>
                          <div className="text-sm text-gray-500">Players: {r.players.length} — Leader: {r.players.find(p=>p.id===r.leaderId)?.name || '-'}{r.started ? ' (started)' : ''}</div>
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
          This is a local demo using localStorage for sync — it's great for testing in multiple tabs but not a production networked server. If you want a networked version (WebSocket or Firebase), tell me and I can add it.
        </footer>
      </div>
    </div>
  );
}
