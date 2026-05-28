# INSTRUCTION.md — Zenly-like Social Location App

> Vibe coding guide for two native codebases: **Swift (iOS)** and **Kotlin (Android)**.
> Read this before prompting any AI coding tool. Keep it open in a side panel.

---

## What we're building

A real-time social location sharing app. Users see their friends on a live map, can react to each other's locations, set statuses, and ghost themselves when needed.

**Two native apps, one shared backend.**

- `apps/ios/` — SwiftUI + Swift 5.9+
- `apps/android/` — Jetpack Compose + Kotlin 1.9+
- `backend/` — Bun + ElysiaJS + TypeScript + PostgreSQL + PostGIS

---

## Repository structure

```
/
├── apps/
│   ├── ios/
│   │   ├── ZenlyApp/
│   │   │   ├── App/                  # App entry point, DI setup
│   │   │   ├── Features/
│   │   │   │   ├── Auth/
│   │   │   │   ├── Map/
│   │   │   │   ├── Friends/
│   │   │   │   ├── Reactions/
│   │   │   │   └── Profile/
│   │   │   ├── Services/
│   │   │   │   ├── LocationService.swift
│   │   │   │   ├── WebSocketService.swift
│   │   │   │   └── APIClient.swift
│   │   │   ├── Models/
│   │   │   └── Utils/
│   │   └── ZenlyAppTests/
│   │
│   └── android/
│       └── app/src/main/
│           ├── java/com/yourapp/zenly/
│           │   ├── ui/
│           │   │   ├── map/
│           │   │   ├── auth/
│           │   │   ├── friends/
│           │   │   ├── reactions/
│           │   │   └── profile/
│           │   ├── data/
│           │   │   ├── location/
│           │   │   ├── network/
│           │   │   └── local/
│           │   ├── domain/
│           │   └── service/
│           └── res/
│
└── backend/
    ├── src/
    │   ├── routes/
    │   ├── services/
    │   ├── models/
    │   ├── websocket/
    │   └── middleware/
    ├── migrations/
    ├── Dockerfile
    ├── docker-compose.yml
    └── .dockerignore
```

---

## Core data models

These are the source of truth. Both apps and the backend must agree on these shapes.

```typescript
// Shared types (backend canonical definitions)

interface User {
  id: string           // UUID
  username: string
  displayName: string
  avatarUrl: string | null
  phone: string        // E.164 format
  createdAt: Date
}

interface Location {
  userId: string
  lat: number          // WGS84
  lng: number          // WGS84
  accuracy: number     // metres
  speed: number | null // m/s
  heading: number | null
  battery: number      // 0–100
  timestamp: Date
  isGhost: boolean
}

interface Friendship {
  id: string
  requesterId: string
  recipientId: string
  status: 'pending' | 'accepted' | 'blocked'
  createdAt: Date
}

interface Reaction {
  id: string
  senderId: string
  recipientId: string
  emoji: string
  sentAt: Date
}

interface Place {
  id: string
  userId: string
  label: string        // 'Home', 'Work', or custom
  lat: number
  lng: number
  radiusMetres: number
}

interface Status {
  userId: string
  emoji: string | null
  text: string | null  // max 60 chars
  expiresAt: Date | null
}
```

---

## iOS — Swift

### Architecture

Use **MVVM + Coordinator**. No MVC.

```
Feature/
├── FeatureView.swift          # SwiftUI view, reads from ViewModel
├── FeatureViewModel.swift     # @MainActor ObservableObject, owns state
├── FeatureCoordinator.swift   # Navigation logic
└── FeatureService.swift       # Business logic / data fetching (if needed)
```

### Key dependencies (Swift Package Manager)

```swift
// Package.swift dependencies
.package(url: "https://github.com/Alamofire/Alamofire", from: "5.9.0"),
.package(url: "https://github.com/daltoniam/Starscream", from: "4.0.0"), // WebSockets
.package(url: "https://github.com/onevcat/Kingfisher", from: "7.0.0"),   // Image loading
```

Maps: use **MapKit** natively (no extra dependency). For Google Maps fallback, add `pod 'GoogleMaps'`.

### Location setup

**Info.plist keys required — without these the app crashes or silently fails:**

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>We need your location to show your friends where you are.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>We use your location in the background so friends can see you even when the app is closed.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
  <string>remote-notification</string>
</array>
```

**LocationService.swift pattern:**

```swift
import CoreLocation
import Combine

@MainActor
final class LocationService: NSObject, ObservableObject {
    private let manager = CLLocationManager()
    @Published var currentLocation: CLLocation?
    @Published var authStatus: CLAuthorizationStatus = .notDetermined
    var isGhostMode = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10  // only update if moved 10m
        manager.allowsBackgroundLocationUpdates = true
        manager.pausesLocationUpdatesAutomatically = false
    }

    func requestPermission() {
        manager.requestAlwaysAuthorization()
    }

    func startTracking() {
        manager.startUpdatingLocation()
    }

    func stopTracking() {
        manager.stopUpdatingLocation()
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        Task { @MainActor in
            self.currentLocation = loc
            if !self.isGhostMode {
                // Push to backend
            }
        }
    }
}
```

### WebSocket client (iOS)

```swift
import Starscream

final class WebSocketService: WebSocketDelegate {
    private var socket: WebSocket?
    var onLocationUpdate: ((Location) -> Void)?

    func connect(token: String) {
        var request = URLRequest(url: URL(string: "wss://api.yourapp.com/ws")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        socket = WebSocket(request: request)
        socket?.delegate = self
        socket?.connect()
    }

    func didReceive(event: WebSocketEvent, client: WebSocketClient) {
        switch event {
        case .text(let text):
            // Decode JSON → Location and call onLocationUpdate
            break
        case .disconnected:
            // Reconnect with exponential backoff
            break
        default:
            break
        }
    }
}
```

### Map view (SwiftUI + MapKit)

```swift
import MapKit
import SwiftUI

struct MapView: View {
    @StateObject private var vm = MapViewModel()

    var body: some View {
        Map(coordinateRegion: $vm.region, annotationItems: vm.friendLocations) { friend in
            MapAnnotation(coordinate: friend.coordinate) {
                FriendAvatarPin(friend: friend)
                    .onTapGesture { vm.selectFriend(friend) }
            }
        }
        .ignoresSafeArea()
        .onAppear { vm.startTracking() }
    }
}
```

### Push notifications (APNs)

Register in `AppDelegate`:

```swift
func application(_ application: UIApplication,
                 didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    application.registerForRemoteNotifications()
    return true
}

func application(_ application: UIApplication,
                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    // POST token to backend: PUT /users/me/apns-token
}
```

### Ghost mode

Ghost mode is a **client-side flag only** — the location service still runs, but the app stops sending updates to the backend.

```swift
// LocationService.swift
func setGhostMode(_ enabled: Bool) {
    isGhostMode = enabled
    // Optionally: POST /locations/ghost { enabled } so backend stops broadcasting you
}
```

### Background location battery tips

- Use `kCLLocationAccuracyHundredMeters` when app is in background, `kCLLocationAccuracyBest` when foregrounded.
- Target max 1 update per 15 seconds in background.
- Use `significantLocationChange` API as a fallback when full updates are paused.

---

## Android — Kotlin

### Architecture

Use **MVVM + UiState** following the official Android architecture guide.

```
feature/map/
├── MapScreen.kt           # Composable, reads uiState from ViewModel
├── MapViewModel.kt        # StateFlow<MapUiState>, hoist all state here
├── MapUiState.kt          # Sealed class / data class for screen state
└── MapRepository.kt       # Data fetching, injected into ViewModel
```

### Key dependencies (libs.versions.toml)

```toml
[versions]
retrofit = "2.11.0"
okhttp = "4.12.0"
maps = "18.2.0"
location = "21.2.0"
room = "2.6.1"
hilt = "2.51.1"
coroutines = "1.8.1"

[libraries]
retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }
retrofit-gson = { module = "com.squareup.retrofit2:converter-gson", version.ref = "retrofit" }
okhttp = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }
maps = { module = "com.google.android.gms:play-services-maps", version.ref = "maps" }
location = { module = "com.google.android.gms:play-services-location", version.ref = "location" }
room-runtime = { module = "androidx.room:room-runtime", version.ref = "room" }
room-ktx = { module = "androidx.room:room-ktx", version.ref = "room" }
hilt-android = { module = "com.google.dagger:hilt-android", version.ref = "hilt" }
coroutines = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
```

### Location setup (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

<!-- Foreground service declaration -->
<service
    android:name=".service.LocationForegroundService"
    android:foregroundServiceType="location"
    android:exported="false" />
```

**LocationService.kt pattern:**

```kotlin
@AndroidEntryPoint
class LocationForegroundService : Service() {
    private lateinit var fusedClient: FusedLocationProviderClient
    private val locationRequest = LocationRequest.Builder(
        Priority.PRIORITY_HIGH_ACCURACY, 15_000L // 15s interval
    ).setMinUpdateDistanceMeters(10f).build()

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            if (!isGhostMode) {
                // Emit via coroutine to WebSocket / API
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        fusedClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper())
        return START_STICKY
    }

    override fun onDestroy() {
        fusedClient.removeLocationUpdates(locationCallback)
        super.onDestroy()
    }
}
```

### WebSocket client (Android)

```kotlin
import okhttp3.*

class WebSocketService @Inject constructor(private val client: OkHttpClient) {
    private var ws: WebSocket? = null
    var onLocationUpdate: ((Location) -> Unit)? = null

    fun connect(token: String) {
        val request = Request.Builder()
            .url("wss://api.yourapp.com/ws")
            .header("Authorization", "Bearer $token")
            .build()

        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                // Parse JSON → Location and invoke onLocationUpdate
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                // Reconnect with exponential backoff (use WorkManager for reliability)
            }
        })
    }

    fun disconnect() { ws?.close(1000, null) }
}
```

### Map screen (Jetpack Compose + Google Maps)

```kotlin
@Composable
fun MapScreen(viewModel: MapViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val cameraPositionState = rememberCameraPositionState()

    GoogleMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = cameraPositionState,
    ) {
        uiState.friendLocations.forEach { friend ->
            MarkerComposable(
                state = MarkerState(position = LatLng(friend.lat, friend.lng)),
                onClick = { viewModel.selectFriend(friend); true }
            ) {
                FriendAvatarPin(friend = friend)
            }
        }
    }
}
```

### Push notifications (FCM)

```kotlin
@AndroidEntryPoint
class ZenlyFirebaseService : FirebaseMessagingService() {
    @Inject lateinit var userRepository: UserRepository

    override fun onNewToken(token: String) {
        // PUT /users/me/fcm-token
        userRepository.updateFcmToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "reaction" -> showReactionNotification(data)
            "nudge"    -> showNudgeNotification(data)
            "arrival"  -> showArrivalNotification(data)
        }
    }
}
```

### Ghost mode

Same logic as iOS — stop sending updates, optionally notify the backend.

```kotlin
// In LocationForegroundService.kt
var isGhostMode: Boolean = false
    set(value) {
        field = value
        // Optional: POST /locations/ghost { enabled: value }
    }
```

### Battery optimisation checklist (Android)

- Request `PRIORITY_BALANCED_POWER_ACCURACY` when app is in background; `PRIORITY_HIGH_ACCURACY` when foregrounded.
- Handle Doze mode: use `WorkManager` with `setExpedited()` for critical syncs.
- Do NOT request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` unless absolutely necessary — Google will flag this.
- Set update interval to 30s minimum in deep background. Users tolerate 30s staleness.

---

## Backend

### Tech stack

| Layer | Choice |
|---|---|
| Runtime | **Bun 1.1+** |
| Language | TypeScript 5 |
| HTTP framework | **ElysiaJS** |
| API docs | **Swagger via `@elysiajs/swagger`** |
| WebSockets | **ElysiaJS built-in WS** |
| Database | PostgreSQL 15 + PostGIS 3 |
| Cache / presence | Redis 7 |
| Auth | JWT (RS256) via `@elysiajs/jwt` |
| ORM | Drizzle ORM (Bun-native, replaces Prisma) |
| Queue | BullMQ (Redis-backed, works with Bun) |
| Deployment | **Docker (Bun image) + Kubernetes** |

### ElysiaJS app entry point (`src/index.ts`)

```typescript
import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { jwt } from '@elysiajs/jwt'
import { cors } from '@elysiajs/cors'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { friendRoutes } from './routes/friends'
import { locationRoutes } from './routes/locations'
import { reactionRoutes } from './routes/reactions'
import { statusRoutes } from './routes/status'
import { placeRoutes } from './routes/places'
import { websocketHandler } from './websocket/handler'

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: { title: 'Zenly API', version: '1.0.0' },
        tags: [
          { name: 'Auth', description: 'Authentication & tokens' },
          { name: 'Users', description: 'User profile management' },
          { name: 'Friends', description: 'Social graph' },
          { name: 'Locations', description: 'Location updates & history' },
          { name: 'Reactions', description: 'Emoji reactions' },
          { name: 'Status', description: 'User statuses' },
          { name: 'Places', description: 'Saved places' },
        ],
      },
      // Swagger UI available at /swagger
    })
  )
  .use(
    jwt({
      name: 'jwt',
      secret: Bun.env.JWT_SECRET!,
      exp: '15m',
    })
  )
  .use(authRoutes)
  .use(userRoutes)
  .use(friendRoutes)
  .use(locationRoutes)
  .use(reactionRoutes)
  .use(statusRoutes)
  .use(placeRoutes)
  .ws('/ws', websocketHandler)
  .listen(Bun.env.PORT ?? 3000)

console.log(`🦊 Elysia running at ${app.server?.hostname}:${app.server?.port}`)
console.log(`📖 Swagger UI at http://localhost:${app.server?.port}/swagger`)

export type App = typeof app
```

### Route example with Swagger tags (`src/routes/locations.ts`)

```typescript
import { Elysia, t } from 'elysia'
import { authMiddleware } from '../middleware/auth'

export const locationRoutes = new Elysia({ prefix: '/locations' })
  .use(authMiddleware)
  .post(
    '/',
    async ({ body, user }) => {
      // Write to Redis + queue Postgres write
      await redis.set(`location:${user.id}`, JSON.stringify(body), { ex: 3600 })
      await locationQueue.add('persist', { userId: user.id, ...body })
      return new Response(null, { status: 204 })
    },
    {
      body: t.Object({
        lat: t.Number(),
        lng: t.Number(),
        accuracy: t.Number(),
        speed: t.Optional(t.Number()),
        heading: t.Optional(t.Number()),
        battery: t.Number({ minimum: 0, maximum: 100 }),
      }),
      detail: { tags: ['Locations'], summary: 'Push a location update' },
    }
  )
  .post(
    '/ghost',
    async ({ body, user }) => {
      await setGhostMode(user.id, body.enabled)
      return new Response(null, { status: 204 })
    },
    {
      body: t.Object({ enabled: t.Boolean() }),
      detail: { tags: ['Locations'], summary: 'Toggle ghost mode' },
    }
  )
  .get(
    '/history',
    async ({ query, user }) => getLocationHistory(user.id, query),
    {
      query: t.Object({
        userId: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
      detail: { tags: ['Locations'], summary: 'Get location history' },
    }
  )
```

### WebSocket handler (`src/websocket/handler.ts`)

ElysiaJS has first-class WebSocket support — no Socket.io needed.

```typescript
import type { ElysiaWS } from 'elysia/ws'

const rooms = new Map<string, Set<ElysiaWS>>()  // userId → sockets

export const websocketHandler = {
  open(ws: ElysiaWS) {
    const userId = ws.data.user?.id
    if (!userId) return ws.close(4001, 'Unauthorized')
    if (!rooms.has(userId)) rooms.set(userId, new Set())
    rooms.get(userId)!.add(ws)
    ws.subscribe(`user:${userId}`)
  },

  async message(ws: ElysiaWS, raw: string) {
    const msg = JSON.parse(raw)

    if (msg.type === 'location:push') {
      const { lat, lng, accuracy, speed, heading, battery } = msg
      const userId = ws.data.user!.id

      // Cache in Redis
      await redis.set(`location:${userId}`, JSON.stringify({ lat, lng, battery }), { ex: 3600 })

      // Async persist to Postgres
      await locationQueue.add('persist', { userId, lat, lng, accuracy, speed, heading, battery })

      // Fanout to online friends
      const friends = await getFriendIds(userId)
      for (const friendId of friends) {
        ws.publish(`user:${friendId}`, JSON.stringify({
          type: 'location:update',
          userId, lat, lng, accuracy, speed, heading, battery,
          timestamp: new Date().toISOString(),
        }))
      }
    }

    if (msg.type === 'subscribe') {
      for (const uid of msg.userIds ?? []) ws.subscribe(`user:${uid}`)
    }

    if (msg.type === 'unsubscribe') {
      for (const uid of msg.userIds ?? []) ws.unsubscribe(`user:${uid}`)
    }
  },

  close(ws: ElysiaWS) {
    const userId = ws.data.user?.id
    if (userId) rooms.get(userId)?.delete(ws)
  },
}
```

### Dependencies (`package.json`)

```json
{
  "dependencies": {
    "elysia": "^1.1.0",
    "@elysiajs/swagger": "^1.1.0",
    "@elysiajs/jwt": "^1.1.0",
    "@elysiajs/cors": "^1.1.0",
    "drizzle-orm": "^0.31.0",
    "postgres": "^3.4.0",
    "ioredis": "^5.4.1",
    "bullmq": "^5.7.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.22.0",
    "bun-types": "latest",
    "typescript": "^5.4.0"
  }
}
```

Install with: `bun install`

### REST API endpoints

```
Auth
  POST   /auth/phone/request-otp      → { requestId }
  POST   /auth/phone/verify-otp       → { accessToken, refreshToken }
  POST   /auth/apple                  → { accessToken, refreshToken }
  POST   /auth/google                 → { accessToken, refreshToken }
  POST   /auth/refresh                → { accessToken }

Users
  GET    /users/me                    → User
  PATCH  /users/me                    → User
  PUT    /users/me/apns-token         → 204
  PUT    /users/me/fcm-token          → 204
  DELETE /users/me                    → 204

Friends
  GET    /friends                     → Friendship[]
  POST   /friends/request             → Friendship
  PATCH  /friends/:id/accept          → Friendship
  DELETE /friends/:id                 → 204
  POST   /friends/:id/block           → 204

Location
  POST   /locations                   → 204  (single update)
  POST   /locations/ghost             → 204  { enabled: boolean }
  GET    /locations/history           → Location[]  ?userId=&from=&to=

Reactions
  POST   /reactions                   → Reaction  { recipientId, emoji }

Status
  PUT    /status                      → Status
  DELETE /status                      → 204

Places
  GET    /places                      → Place[]
  POST   /places                      → Place
  PATCH  /places/:id                  → Place
  DELETE /places/:id                  → 204
```

### WebSocket events

ElysiaJS handles WebSockets natively at `ws://api.yourapp.com/ws`. No Socket.io client library needed — use the platform's native WebSocket API (Starscream on iOS, OkHttp on Android).

```typescript
// Server → Client
'location:update'    // { userId, lat, lng, accuracy, speed, heading, battery, timestamp }
'friend:online'      // { userId }
'friend:offline'     // { userId }
'reaction:received'  // { senderId, emoji, sentAt }
'nudge:received'     // { senderId, sentAt }
'status:update'      // { userId, emoji, text, expiresAt }

// Client → Server
'location:push'      // { lat, lng, accuracy, speed, heading, battery }
'subscribe'          // { userIds: string[] }   — subscribe to friend updates
'unsubscribe'        // { userIds: string[] }
```

### PostgreSQL schema (key tables)

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username     TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  phone        TEXT UNIQUE,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE friendships (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | blocked
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, recipient_id)
);

CREATE TABLE locations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  geom         GEOMETRY(Point, 4326) NOT NULL,  -- PostGIS point
  accuracy     FLOAT,
  speed        FLOAT,
  heading      FLOAT,
  battery      INT,
  is_ghost     BOOLEAN DEFAULT false,
  recorded_at  TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX locations_user_time_idx ON locations(user_id, recorded_at DESC);
CREATE INDEX locations_geom_idx ON locations USING GIST(geom);

CREATE TABLE places (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  geom         GEOMETRY(Point, 4326) NOT NULL,
  radius_m     INT NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE reactions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  emoji        TEXT NOT NULL,
  sent_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE statuses (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  emoji        TEXT,
  text         TEXT CHECK (char_length(text) <= 60),
  expires_at   TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE device_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL,  -- 'apns' | 'fcm'
  token        TEXT NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, platform)
);
```

### Location fanout logic

```
User pushes location via WebSocket ('location:push')
  └── Write to Redis: SET location:{userId} {json} EX 3600
  └── Write to Postgres (locations table) async via BullMQ
  └── Fetch friends list from Redis cache (or Postgres if cold)
  └── For each accepted friend who is online:
        └── ws.publish(`user:{friendId}`, location:update payload)
```

This pattern keeps latency < 100ms. ElysiaJS `ws.publish()` uses its built-in pub/sub — no Socket.io adapter required. For multi-instance deployments, replace with a Redis-backed pub/sub adapter.

### Docker setup

#### `backend/Dockerfile`

```dockerfile
# Use the official Bun image
FROM oven/bun:1.1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Build stage (type-check only — Bun runs TS directly, no compile needed)
FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Keys mounted at runtime via Docker secret / volume
# ENV vars injected via docker-compose or Kubernetes secret

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

#### `backend/.dockerignore`

```
node_modules
.env
keys/
*.log
.DS_Store
```

#### `backend/docker-compose.yml`

```yaml
version: '3.9'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://zenly:zenly@postgres:5432/zenly
      REDIS_URL: redis://redis:6379
    volumes:
      - ./keys:/app/keys:ro   # Mount JWT/APNS keys read-only
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgis/postgis:15-3.4-alpine
    environment:
      POSTGRES_USER: zenly
      POSTGRES_PASSWORD: zenly
      POSTGRES_DB: zenly
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U zenly"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

Start everything with:

```bash
docker compose up -d
```

Swagger UI will be available at `http://localhost:3000/swagger` once the `api` container is healthy.

#### Running migrations inside Docker

```bash
# Run Drizzle migrations against the containerised Postgres
docker compose exec api bun run drizzle-kit migrate
```

---

## Shared rules for AI prompts

When prompting an AI coding tool (Cursor, GitHub Copilot, Claude Code, etc.), always include the relevant section from this file as context. Below are patterns for common tasks.

### Prompting for a new feature

```
Context: [paste relevant section from this INSTRUCTION.md]

Task: Implement [feature name] for [iOS/Android/backend].

Requirements:
- Follow the architecture described above (MVVM for iOS/Android)
- Use the data models defined in the Core data models section
- The API contract is: [paste relevant endpoint]
- The WebSocket event is: [paste relevant event]
- Do not introduce new dependencies unless listed in the stack above

Acceptance criteria:
- [list specific, testable criteria]
```

### Prompting for the real-time location layer

```
I'm building the real-time location update system.

Backend: Bun + ElysiaJS. WebSocket handler lives in src/websocket/handler.ts.
When a client sends a 'location:push' message, the server should:
1. Cache the location in Redis (SET location:{userId} {json} EX 3600)
2. Queue a Postgres write via BullMQ
3. Fetch the user's friend list (friendships table, status='accepted'), cached in Redis for 5 min
4. Fanout via ws.publish(`user:{friendId}`, 'location:update' payload) for each online friend

iOS client: Uses Starscream (native WebSocket, no Socket.io). On receiving 'location:update',
update the MapViewModel's @Published friendLocations array.

Android client: Uses OkHttp WebSocket. On receiving 'location:update', emit to
a SharedFlow<Location> in MapViewModel, which updates the Compose state.

Write the [backend handler / iOS client / Android client] for this.
```

### Prompting for the map screen

```
I'm implementing the live map screen.

iOS (SwiftUI + MapKit):
- Show friends as custom avatar pins (circular image with a thin border)
- My own pin is a different colour
- Tapping a friend pin opens a bottom sheet showing their name, status, and last seen time
- Map should auto-follow my location with a "re-center" button when I drag away
- Use MapViewModel (ObservableObject) with @Published friendLocations: [FriendLocation]

Android (Jetpack Compose + Google Maps SDK):
- Same pin and bottom sheet behaviour
- Use MapUiState data class and StateFlow<MapUiState> in MapViewModel
- Bottom sheet is a ModalBottomSheet composable

Implement the [iOS / Android] map screen.
```

### Prompting for ghost mode

```
Implement ghost mode toggle for [iOS / Android].

When ghost mode is ON:
- LocationService stops sending updates to the backend
- The user is removed from all friends' maps (backend endpoint: POST /locations/ghost { enabled: true })
- A ghost icon appears on the map screen
- The setting persists across app restarts (UserDefaults on iOS / DataStore on Android)

When ghost mode is OFF:
- Resume sending location updates
- Notify backend: POST /locations/ghost { enabled: false }

On iOS use UserDefaults + @AppStorage. On Android use DataStore<Preferences>.
```

---

## Privacy & compliance checklist

Before submitting to either app store:

- [ ] Privacy policy URL live and accessible
- [ ] Data safety / privacy nutrition label filled out accurately
- [ ] "Always On" location permission justification written (required for App Store review)
- [ ] GDPR delete endpoint working: `DELETE /users/me` removes all user data and location history
- [ ] Location data retention policy implemented (recommend: purge history > 30 days via cron)
- [ ] No location data logged to external analytics tools
- [ ] Push notification content does not reveal precise location in notification text
- [ ] Users can export their own data (GDPR article 20)

---

## Environment variables

### Backend (.env)

```env
DATABASE_URL=postgresql://zenly:zenly@localhost:5432/zenly
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=com.yourapp.zenly
APNS_KEY_PATH=./keys/apns.p8
FCM_PROJECT_ID=your-firebase-project
FCM_SERVICE_ACCOUNT_PATH=./keys/firebase-admin.json
PORT=3000
SWAGGER_ENABLED=true        # set false in production if desired
BUN_ENV=development
```

### iOS (xcconfig)

```
API_BASE_URL = https://api.yourapp.com
WS_URL = wss://api.yourapp.com/ws
GOOGLE_MAPS_API_KEY = YOUR_KEY_HERE
```

### Android (local.properties / BuildConfig)

```properties
API_BASE_URL=https://api.yourapp.com
WS_URL=wss://api.yourapp.com/ws
GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE
```

---

## Local dev setup

```bash
# 1. Start backend (API + Postgres + Redis — all in Docker)
cd backend
cp .env.example .env          # fill in APNS/FCM/JWT values
docker compose up -d          # starts api, postgres, redis

# Watch logs
docker compose logs -f api

# Run DB migrations
docker compose exec api bun run drizzle-kit migrate

# Swagger UI: http://localhost:3000/swagger

# 2. Backend — run outside Docker for hot-reload during dev
cd backend
bun install
bun --hot src/index.ts        # hot-reload on file save

# 3. iOS
cd apps/ios
open ZenlyApp.xcodeproj
# Select simulator, hit Run

# 4. Android
cd apps/android
# Open in Android Studio, select emulator, run
# Google Maps requires a real device or API key configured in local.properties
```

---

## What NOT to do

- **Do not use React Native or Flutter.** Both apps are native. Platform-specific location behaviour is too important to abstract.
- **Do not poll the backend for location.** Everything real-time goes over WebSocket. REST is only for CRUD operations.
- **Do not store raw location history client-side beyond 7 days.** Keep it on the backend.
- **Do not skip the foreground service on Android.** Background location without it gets killed immediately on Android 12+.
- **Do not request `ACCESS_BACKGROUND_LOCATION` on Android without requesting `ACCESS_FINE_LOCATION` first.** The permission flow must be sequential.
- **Do not hardcode API keys in source.** Use xcconfig (iOS) and local.properties / BuildConfig (Android). Use `.env` on the backend — never commit it.
- **Do not share a single WebSocket connection across multiple features.** Have one central WebSocketService and route events to feature-specific handlers.
- **Do not use `WidthType.PERCENTAGE` in Postgres queries.** Always use explicit coordinates and PostGIS functions.
- **Do not use `npm install` or `npx` in the backend.** This is a Bun project — use `bun install` and `bunx`.
- **Do not add Socket.io to the backend.** ElysiaJS has built-in WebSocket support via `.ws()`. Socket.io is not compatible with the Bun runtime.
- **Do not use Prisma.** Use Drizzle ORM — it is Bun-native and works with PostGIS. Prisma's query engine binary does not run on Bun.
- **Do not expose Swagger UI in production unless behind auth.** Set `SWAGGER_ENABLED=false` or gate the `/swagger` route on `BUN_ENV !== 'production'`.

---

*Last updated: switched backend to Bun + ElysiaJS + Swagger; added Docker/docker-compose setup.*
