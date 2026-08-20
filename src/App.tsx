import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { io } from "socket.io-client";
import { GoogleGenAI, Modality } from "@google/genai";

// Fix for default marker icons in Leaflet with React
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

// Custom icons for different resource types
const ambulanceIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/1048/1048329.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const fireTruckIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/785/785116.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const policeIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/2563/2563350.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

const incidentIcon = new L.Icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

function ChangeView({ center }: { center: [number, number] }) {
  const map = useMap();
  map.setView(center, map.getZoom());
  return null;
}

export default function App() {
  const [mode, setMode] = useState<"dispatcher" | "responder">("dispatcher");
  const [selectedResourceId, setSelectedResourceId] = useState<string>("");
  const [activeAssignment, setActiveAssignment] = useState<any>(null);
  const socketRef = useRef<any>(null);

  const [incidentType, setIncidentType] = useState("Medical");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [resources, setResources] = useState<any[]>([]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([37.7749, -122.4194]);

  const [dbInfo, setDbInfo] = useState<any>(null);
  const [locating, setLocating] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>("");

  const generateLogo = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: 'A professional, minimalist logo for a city emergency network, featuring a shield and a pulse line, clean vector style, red and dark grey colors, white background',
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "1:1"
          },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          setLogoUrl(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (err) {
      console.error("Failed to generate logo:", err);
    }
  };

  useEffect(() => {
    generateLogo();
  }, []);

  const fetchDbInfo = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setDbInfo(data);
    } catch (err) {
      console.error("Failed to fetch DB info");
    }
  };

  const fetchResources = async () => {
    try {
      const res = await fetch("/api/resources");
      const data = await res.json();
      setResources(data);
    } catch (err) {
      console.error("Failed to fetch resources");
    }
  };

  const getMyLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLat(latitude.toString());
        setLng(longitude.toString());
        setMapCenter([latitude, longitude]);
        setLocating(false);
      },
      (error) => {
        console.error("Error getting location:", error);
        alert("Unable to retrieve your location. Please ensure location access is granted.");
        setLocating(false);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/report-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_type: incidentType,
          description,
          latitude: parseFloat(lat),
          longitude: parseFloat(lng),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setResult(data);
      if (data.incident && data.incident.location) {
        const [lng, lat] = data.incident.location.coordinates;
        setMapCenter([lat, lng]);
      }
      fetchResources(); // Refresh list
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    try {
      const res = await fetch("/api/seed-resources", { method: "POST" });
      const data = await res.json();
      alert(data.message);
      fetchResources();
    } catch (err) {
      alert("Error seeding data");
    }
  };

  const handleReset = async () => {
    try {
      const res = await fetch("/api/reset-resources", { method: "POST" });
      const data = await res.json();
      alert(data.message);
      fetchResources();
    } catch (err) {
      alert("Error resetting resources");
    }
  };

  const playVoiceAlert = async (incident: any) => {
    if (isSpeaking) return;
    setIsSpeaking(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Say cheerfully: Emergency alert! You have been assigned to a new ${incident.incident_type} incident. Description: ${incident.description || 'No description provided'}. Please check your dashboard for details. Stay safe.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
        await audio.play();
      }
    } catch (error) {
      console.error("Gemini TTS Error:", error);
      // Fallback to browser TTS if Gemini fails
      const utterance = new SpeechSynthesisUtterance(`Emergency alert! New ${incident.incident_type} incident assigned.`);
      window.speechSynthesis.speak(utterance);
    } finally {
      setIsSpeaking(false);
    }
  };

  React.useEffect(() => {
    fetchResources();

    // Initialize Socket.io
    socketRef.current = io();

    socketRef.current.on("incident:assigned", (data: any) => {
      console.log("Assignment received:", data);
      setActiveAssignment(data.incident);
      
      // 1. Play a siren sound
      try {
        const audio = new Audio("https://actions.google.com/sounds/v1/emergency/ambulance_siren.ogg");
        audio.play();
      } catch (e) {
        console.warn("Audio playback failed", e);
      }

      // 2. Play AI Voice Alert (Gemini TTS)
      playVoiceAlert(data.incident);

      // 3. Show a browser notification if possible
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("🚨 EMERGENCY ASSIGNMENT", { body: data.message });
      } else {
        alert("🚨 NEW ASSIGNMENT: " + data.message);
      }
    });

    socketRef.current.on("resource:location-updated", (data: any) => {
      setResources(prev => prev.map(res => 
        res._id === data.resourceId 
          ? { ...res, location: { ...res.location, coordinates: [data.longitude, data.latitude] } }
          : res
      ));
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    if (mode === "responder" && selectedResourceId && socketRef.current) {
      socketRef.current.emit("join-resource-room", selectedResourceId);
      fetchActiveAssignment(selectedResourceId);

      // Start tracking location for the responder
      let watchId: number;
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            socketRef.current.emit("resource:update-location", {
              resourceId: selectedResourceId,
              latitude,
              longitude
            });
          },
          (err) => console.error("Error watching location:", err),
          { enableHighAccuracy: true }
        );
      }

      return () => {
        if (watchId) navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [mode, selectedResourceId]);

  const fetchActiveAssignment = async (resourceId: string) => {
    if (!resourceId) return;
    try {
      const res = await fetch(`/api/active-incident/${resourceId}`);
      const data = await res.json();
      if (data) {
        setActiveAssignment(data);
      } else {
        setActiveAssignment(null);
      }
    } catch (err) {
      console.error("Failed to fetch active assignment", err);
    }
  };

  const handleResolve = async () => {
    if (!activeAssignment) return;
    
    setLoading(true);
    try {
      const res = await fetch("/api/resolve-incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId: activeAssignment._id }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setActiveAssignment(null);
        fetchResources();
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      alert("Error resolving incident: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const requestNotificationPermission = () => {
    if ("Notification" in window) {
      Notification.requestPermission();
    }
  };

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: "1000px", margin: "20px auto", padding: "20px", border: "1px solid #ccc", borderRadius: "12px", backgroundColor: "#fcfcfc", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "2px solid #eee", paddingBottom: "15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          {logoUrl ? (
            <img 
              src={logoUrl} 
              alt="Logo" 
              referrerPolicy="no-referrer"
              style={{ width: "50px", height: "50px", borderRadius: "8px", border: "1px solid #eee" }} 
            />
          ) : (
            <div style={{ width: "50px", height: "50px", backgroundColor: "#d32f2f", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "24px", fontWeight: "bold" }}>
              🚨
            </div>
          )}
          <div>
            <h1 style={{ margin: 0, color: "#1a1a1a", fontSize: "24px" }}>City Emergency Network</h1>
            <p style={{ margin: "5px 0 0 0", fontSize: "12px", color: "#666" }}>Real-time Dispatch & Response System</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div style={{ display: "flex", backgroundColor: "#eee", borderRadius: "20px", padding: "4px" }}>
            <button 
              onClick={() => setMode("dispatcher")}
              style={{ 
                padding: "6px 16px", 
                borderRadius: "16px", 
                border: "none", 
                cursor: "pointer",
                backgroundColor: mode === "dispatcher" ? "#fff" : "transparent",
                fontWeight: mode === "dispatcher" ? "bold" : "normal",
                boxShadow: mode === "dispatcher" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
              }}
            >
              Dispatcher
            </button>
            <button 
              onClick={() => {
                setMode("responder");
                requestNotificationPermission();
              }}
              style={{ 
                padding: "6px 16px", 
                borderRadius: "16px", 
                border: "none", 
                cursor: "pointer",
                backgroundColor: mode === "responder" ? "#fff" : "transparent",
                fontWeight: mode === "responder" ? "bold" : "normal",
                boxShadow: mode === "responder" ? "0 2px 4px rgba(0,0,0,0.1)" : "none"
              }}
            >
              Responder
            </button>
          </div>
          <button onClick={handleReset} style={{ fontSize: "12px", padding: "8px 12px", cursor: "pointer", backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}>Reset</button>
          <button onClick={handleSeed} style={{ fontSize: "12px", padding: "8px 12px", cursor: "pointer", backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}>Seed</button>
        </div>
      </div>

      {mode === "dispatcher" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px", backgroundColor: "#fff", padding: "20px", borderRadius: "8px", border: "1px solid #eee", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
              <h2 style={{ fontSize: "18px", margin: "0 0 10px 0", color: "#d32f2f" }}>🚨 Report Incident</h2>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Incident Type:</label>
                <select 
                  value={incidentType} 
                  onChange={(e) => setIncidentType(e.target.value)}
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
                >
                  <option value="Medical">Medical Emergency</option>
                  <option value="Fire">Fire Incident</option>
                  <option value="Accident">Road Accident</option>
                  <option value="Crime">Crime / Police</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Description:</label>
                <textarea 
                  value={description} 
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the situation..."
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc", minHeight: "80px" }}
                />
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Latitude:</label>
                  <input 
                    type="number" 
                    step="any"
                    value={lat} 
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="e.g. 37.7749"
                    required
                    style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Longitude:</label>
                  <input 
                    type="number" 
                    step="any"
                    value={lng} 
                    onChange={(e) => setLng(e.target.value)}
                    placeholder="e.g. -122.4194"
                    required
                    style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
                  />
                </div>
                <button 
                  type="button"
                  onClick={getMyLocation}
                  disabled={locating}
                  style={{ 
                    padding: "8px 12px", 
                    borderRadius: "4px", 
                    border: "1px solid #ccc", 
                    backgroundColor: "#f0f0f0", 
                    cursor: locating ? "not-allowed" : "pointer",
                    height: "38px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="Get Current Location"
                >
                  {locating ? "..." : "📍"}
                </button>
              </div>

              <button 
                type="submit" 
                disabled={loading}
                style={{ 
                  padding: "12px", 
                  backgroundColor: loading ? "#ccc" : "#d32f2f", 
                  color: "white", 
                  border: "none", 
                  borderRadius: "4px", 
                  fontWeight: "bold", 
                  cursor: loading ? "default" : "pointer" 
                }}
              >
                {loading ? "Reporting..." : "Dispatch Emergency Response"}
              </button>
            </form>

            {error && (
              <div style={{ padding: "15px", backgroundColor: "#ffebee", color: "#c62828", borderRadius: "4px", border: "1px solid #ef9a9a" }}>
                <strong>Error:</strong> {error}
              </div>
            )}

            {result && (
              <div style={{ padding: "20px", backgroundColor: "#e8f5e9", color: "#2e7d32", borderRadius: "4px", border: "1px solid #a5d6a7" }}>
                <h3 style={{ marginTop: 0 }}>Resource Dispatched!</h3>
                <p><strong>Message:</strong> {result.message}</p>
                <div style={{ fontSize: "12px", color: "#666" }}>
                  Incident ID: {result.incident._id} <br />
                  Resource ID: {result.assigned_resource._id}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ height: "400px", width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid #ccc" }}>
              <MapContainer center={mapCenter} zoom={13} style={{ height: "100%", width: "100%" }}>
                <ChangeView center={mapCenter} />
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                
                {/* Resources Markers */}
                {resources.map((res) => {
                  let icon = ambulanceIcon;
                  if (res.type === "fire_truck") icon = fireTruckIcon;
                  if (res.type === "police") icon = policeIcon;

                  return (
                    <Marker 
                      key={res._id} 
                      position={[res.location.coordinates[1], res.location.coordinates[0]]}
                      icon={icon}
                    >
                      <Popup>
                        <strong>{res.type.replace("_", " ").toUpperCase()}</strong><br />
                        Status: {res.available ? "Available" : "Busy"}<br />
                        ID: {res._id.slice(-6)}
                      </Popup>
                    </Marker>
                  );
                })}

                {/* Current Incident Marker */}
                {result && result.incident && (
                  <Marker 
                    position={[result.incident.location.coordinates[1], result.incident.location.coordinates[0]]}
                    icon={incidentIcon}
                  >
                    <Popup>
                      <strong>ACTIVE INCIDENT</strong><br />
                      Type: {result.incident.incident_type}<br />
                      Status: {result.incident.status}
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            </div>

            <div style={{ borderTop: "1px solid #eee", paddingTop: "10px" }}>
              <h2 style={{ fontSize: "18px", marginBottom: "15px" }}>Resource Status</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "300px", overflowY: "auto" }}>
                {resources.length === 0 && <p style={{ color: "#666", fontSize: "14px" }}>No resources found in database. Click 'Seed Data' to add some.</p>}
                {resources.map((res) => (
                  <div key={res._id} style={{ padding: "10px", backgroundColor: "#f9f9f9", borderRadius: "4px", border: "1px solid #eee", fontSize: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ 
                        display: "inline-block", 
                        padding: "2px 6px", 
                        backgroundColor: "#eee", 
                        borderRadius: "3px", 
                        fontSize: "10px", 
                        marginRight: "8px",
                        textTransform: "uppercase",
                        fontWeight: "bold"
                      }}>
                        {res.type.replace("_", " ")}
                      </span>
                      <strong>ID:</strong> {res._id.slice(-6)}...
                    </div>
                    <div style={{ color: res.available ? "#2e7d32" : "#c62828", fontWeight: "bold" }}>
                      {res.available ? "Available" : "Busy"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "600px", margin: "0 auto" }}>
          <div style={{ backgroundColor: "#fff", padding: "20px", borderRadius: "8px", border: "1px solid #eee", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <h2 style={{ fontSize: "18px", margin: "0 0 15px 0" }}>Responder Dashboard</h2>
            <label style={{ display: "block", marginBottom: "8px", fontWeight: "bold" }}>Select Your Resource ID:</label>
            <select 
              value={selectedResourceId} 
              onChange={(e) => setSelectedResourceId(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #ddd", marginBottom: "10px" }}
            >
              <option value="">-- Select Resource --</option>
              {resources.map(res => (
                <option key={res._id} value={res._id}>
                  {res.type.replace("_", " ").toUpperCase()} - {res._id.slice(-6)}
                </option>
              ))}
            </select>
            <p style={{ fontSize: "12px", color: "#666" }}>
              {selectedResourceId ? "Listening for assignments..." : "Please select your vehicle to start receiving calls."}
            </p>
            {selectedResourceId && (
              <button 
                onClick={() => fetchActiveAssignment(selectedResourceId)}
                style={{ marginTop: "10px", padding: "8px 12px", fontSize: "12px", cursor: "pointer", backgroundColor: "#f0f0f0", border: "1px solid #ccc", borderRadius: "4px" }}
              >
                🔄 Refresh Assignment
              </button>
            )}
          </div>

          {activeAssignment ? (
            <div style={{ backgroundColor: "#fff", padding: "25px", borderRadius: "12px", border: "2px solid #d32f2f", boxShadow: "0 10px 30px rgba(211, 47, 47, 0.15)", animation: "pulse 2s infinite" }}>
              <h2 style={{ color: "#d32f2f", margin: "0 0 15px 0", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "24px" }}>🚨</span> ACTIVE ASSIGNMENT
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", color: "#666", textTransform: "uppercase", fontWeight: "bold" }}>Type</label>
                  <div style={{ fontSize: "18px", fontWeight: "bold" }}>{activeAssignment.incident_type}</div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", color: "#666", textTransform: "uppercase", fontWeight: "bold" }}>Description</label>
                  <div style={{ fontSize: "16px" }}>{activeAssignment.description || "No description provided."}</div>
                </div>
                <div>
                  <label style={{ fontSize: "12px", color: "#666", textTransform: "uppercase", fontWeight: "bold" }}>Location</label>
                  <div style={{ fontSize: "14px" }}>
                    Lat: {activeAssignment.location.coordinates[1]}, Lng: {activeAssignment.location.coordinates[0]}
                  </div>
                </div>
                <button 
                  onClick={handleResolve}
                  disabled={loading}
                  style={{ 
                    marginTop: "10px",
                    padding: "15px", 
                    backgroundColor: "#2e7d32", 
                    color: "white", 
                    border: "none", 
                    borderRadius: "8px", 
                    fontWeight: "bold", 
                    fontSize: "16px",
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(46, 125, 50, 0.3)"
                  }}
                >
                  {loading ? "Processing..." : "Mark as Resolved & Return to Base"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: "40px", textAlign: "center", backgroundColor: "#f9f9f9", borderRadius: "8px", border: "1px dashed #ccc" }}>
              <div style={{ fontSize: "40px", marginBottom: "10px" }}>📡</div>
              <h3 style={{ margin: 0, color: "#666" }}>Waiting for dispatch...</h3>
              <p style={{ color: "#999", fontSize: "14px" }}>Keep this window open to receive real-time alerts.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
