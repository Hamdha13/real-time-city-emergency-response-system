# City Emergency Network

A full-stack emergency dispatch and responder coordination platform. The system matches incoming emergency reports with the nearest available unit (ambulances, fire trucks, police) using geospatial indexing, streams live vehicle telemetry to a central dispatcher map via WebSockets, and delivers voice-guided dispatch notifications to field personnel.

---

## Overview & Architecture

The application is structured as an event-driven system with two primary operational views:

1. **Dispatcher Console**: Visualizes all active units and reported incidents on an interactive map. When an incident is reported (via GPS coordinate capture or manual input), the backend queries MongoDB for the closest available unit matching the required emergency type within a 15 km radius, locks the unit, creates the incident record, and pushes a real-time dispatch event over Socket.io.
2. **Responder Terminal**: Mobile-friendly PWA interface where responders attach to their assigned vehicle ID. Responders receive instant audio sirens, Gemini-generated speech alerts, and turn-by-turn coordinate data. While active, the responder terminal streams background GPS telemetry (`watchPosition`) back to the server, updating the dispatcher's live map in real time.

```
                  ┌───────────────────────────────┐
                  │       Central Dispatcher      │
                  │   (Interactive Fleet Map)     │
                  └───────────────▲───────────────┘
                                  │ Live WebSocket Updates
                                  │ (resource:location-updated)
                                  │
┌─────────────────────────┐   ┌───┴────────────────────────┐   ┌─────────────────────────┐
│     Incident Intake     ├──►│   Node.js / Express Server ├──►│  Responder Mobile Unit  │
│ (GPS / Category Intake) │   │  (Geospatial Engine $near) │   │  (Audio & Voice Alert)  │
└─────────────────────────┘   └───┬────────────────────────┘   └────────────▲────────────┘
                                  │                                         │
                                  ▼                                         │ Live GPS Stream
                       ┌──────────────────────┐                             │ (watchPosition)
                       │    MongoDB Atlas     │                             │
                       │ (2dsphere index:15km)│─────────────────────────────┘
                       └──────────────────────┘
```

---

## Key Features

- **Geospatial Nearest-Neighbor Dispatch**: Uses MongoDB `2dsphere` indexes and `$near` sphere queries with a 15 km threshold (`$maxDistance: 15000`) to find and lock the closest eligible unit.
- **Bi-Directional Real-Time Communication**: Socket.io rooms enable unit-specific dispatch channels, broadcast status changes, and sub-second location stream updates without polling.
- **Live Fleet Tracking**: Responders emit browser-level geolocation updates that dynamically move Leaflet map markers on all connected dispatch monitors.
- **AI Voice-Assisted Dispatch**: Integrates `@google/genai` (Gemini Text-to-Speech) to generate synthetic voice alerts for responders, speaking the emergency category and description directly upon dispatch.
- **Progressive Web App (PWA)**: Standalone installation support on Android (Chrome) and iOS (Safari) with Web App Manifest and Service Worker caching.
- **Fault-Tolerant State Recovery**: Responders who connect after a dispatch can query `/api/active-incident/:resourceId` or trigger manual synchronization.

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Leaflet / React-Leaflet, Tailwind CSS, Motion |
| **Backend** | Node.js, Express 4, Socket.io, TypeScript (`tsx` runtime) |
| **Database** | MongoDB Atlas with Mongoose (2dsphere geospatial indexing) |
| **AI / Audio** | Google GenAI SDK (`@google/genai` for dynamic branding & TTS dispatch audio) |
| **Tooling & Build** | Vite 6, Service Worker API, Web App Manifest |

---

## Project Structure

```
├── server.ts             # Express server, Socket.io broker, Mongoose models & API routes
├── src/
│   ├── App.tsx           # React UI (Dispatcher map, responder dashboard, Socket listeners)
│   ├── main.tsx          # Application bootstrap & Service Worker registration
│   └── index.css         # Tailwind CSS styling and theme setup
├── public/
│   ├── manifest.json     # PWA manifest metadata
│   └── sw.js             # Service worker cache strategy
├── package.json          # Dependencies and execution scripts
├── vite.config.ts        # Vite configuration and proxy rules
└── metadata.json         # Environment permissions and platform metadata
```

---

## Getting Started

### Prerequisites
- Node.js (v20+ recommended)
- MongoDB Atlas cluster or local MongoDB instance (v6.0+)
- Google Gemini API Key (optional, for AI logo & voice alerts)

### Installation

1. **Clone the repository and install dependencies:**
   ```bash
   git clone <repo-url>
   cd city-emergency-network
   npm install
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   MONGODB_URI="mongodb+srv://<user>:<password>@cluster0.mongodb.net/city_incident_db"
   GEMINI_API_KEY="your-gemini-api-key"
   ```

3. **Start the Development Server:**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:3000`.

4. **Build for Production:**
   ```bash
   npm run build
   npm start
   ```

---

## API Reference

### Incident Management
- `POST /api/report-incident` — Submits an incident report and assigns the nearest unit.
  - **Body**: `{ "incident_type": "Medical" | "Fire" | "Accident" | "Crime", "description": string, "latitude": number, "longitude": number }`
- `POST /api/resolve-incident` — Closes an incident and marks the assigned unit as available.
  - **Body**: `{ "incidentId": string }`
- `GET /api/incidents` — Retrieves all recorded incidents.
- `GET /api/active-incident/:resourceId` — Retrieves the current active assignment for a given vehicle.

### Fleet & Fleet Diagnostics
- `GET /api/resources` — Lists all registered vehicles, their coordinates, and availability.
- `POST /api/seed-resources` — Seeds initial demo fleet (ambulances, fire engines, patrol units) around San Francisco.
- `POST /api/reset-resources` — Resets all units to available status.
- `GET /api/health` — System status, MongoDB connection health, and collection statistics.

---

## Socket.io Event Protocol

| Event Name | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join-resource-room` | Client ➔ Server | `resourceId: string` | Subscribes a responder device to its vehicle's private dispatch channel. |
| `resource:update-location` | Client ➔ Server | `{ resourceId, latitude, longitude }` | Emitted by responder GPS watcher as the unit navigates. |
| `resource:location-updated` | Server ➔ Broadcast | `{ resourceId, latitude, longitude }` | Pushed to all dispatchers to move the unit's marker on the map in real time. |
| `incident:assigned` | Server ➔ Room | `{ incident, message }` | Direct alert sent to the assigned vehicle with incident payload. |
