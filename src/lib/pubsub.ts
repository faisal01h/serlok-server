/**
 * Holds a reference to the Bun HTTP/WS server so HTTP routes can publish
 * to WebSocket topics without circular imports.
 */
let _server: { publish: (topic: string, data: string) => void } | null = null

export function setServer(s: { publish: (topic: string, data: string) => void }) {
  _server = s
}

export function publishToUser(userId: string, payload: object) {
  _server?.publish(`user:${userId}`, JSON.stringify(payload))
}
