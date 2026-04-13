import type { WebSocket } from 'ws'

const roomSockets = new Map<string, Set<WebSocket>>()
const socketRooms = new WeakMap<WebSocket, Set<string>>()
/** JWT-sub (Nutzer-ID) pro WebSocket – für PTT an Zielpersonen. */
const socketUserIds = new Map<WebSocket, string>()

export function bindSocketUser(ws: WebSocket, userId: string) {
  socketUserIds.set(ws, userId)
}

export function clearSocketUser(ws: WebSocket) {
  socketUserIds.delete(ws)
}

export function getSocketUserId(ws: WebSocket): string | undefined {
  return socketUserIds.get(ws)
}

export function getRoomSockets(groupId: string): Set<WebSocket> | undefined {
  return roomSockets.get(groupId)
}

function track(ws: WebSocket, groupId: string) {
  let rs = socketRooms.get(ws)
  if (!rs) {
    rs = new Set()
    socketRooms.set(ws, rs)
  }
  rs.add(groupId)
  let set = roomSockets.get(groupId)
  if (!set) {
    set = new Set()
    roomSockets.set(groupId, set)
  }
  set.add(ws)
}

/** Entfernt Socket aus allen Gruppenräumen (z. B. vor neuem join oder bei close). */
export function leaveAllRooms(ws: WebSocket) {
  const rooms = socketRooms.get(ws)
  if (!rooms) return
  for (const gid of rooms) {
    const set = roomSockets.get(gid)
    set?.delete(ws)
    if (set && set.size === 0) roomSockets.delete(gid)
  }
  socketRooms.delete(ws)
}

export function joinRoom(ws: WebSocket, groupId: string) {
  leaveAllRooms(ws)
  track(ws, groupId)
}

export function broadcastGroup(groupId: string, payload: unknown) {
  const set = roomSockets.get(groupId)
  if (!set?.size) return
  const raw = JSON.stringify(payload)
  for (const client of set) {
    try {
      if (client.readyState === 1) client.send(raw)
    } catch {
      /* ignore */
    }
  }
}
