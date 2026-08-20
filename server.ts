import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("CRITICAL: MONGODB_URI is not defined in environment variables.");
}

mongoose.connect(MONGODB_URI || "mongodb://127.0.0.1:27017/city_incident_db", {
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10, // Limit connections to prevent EMFILE
  dbName: "city_incident_db", // Force the database name
})
  .then(() => console.log("Connected to MongoDB Atlas"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Socket.io Connection
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Allow resources to join a room specific to their ID
  socket.on("join-resource-room", (resourceId) => {
    socket.join(resourceId);
    console.log(`Socket ${socket.id} joined room for resource ${resourceId}`);
  });

  // Handle resource location updates
  socket.on("resource:update-location", async (data) => {
    const { resourceId, latitude, longitude } = data;
    try {
      await Resource.findByIdAndUpdate(resourceId, {
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
      });
      // Broadcast to all clients (dispatchers)
      io.emit("resource:location-updated", { resourceId, latitude, longitude });
    } catch (err) {
      console.error("Error updating resource location:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// Middleware to check DB connection
const checkDbConnection = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ 
      error: "Database not connected. Please ensure MONGODB_URI is correctly configured in the Secrets panel." 
    });
  }
  next();
};

// Schemas
const resourceSchema = new mongoose.Schema({
  type: { type: String, default: "ambulance" },
  available: { type: Boolean, default: true },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
});

// Create 2dsphere index for geospatial queries
resourceSchema.index({ location: "2dsphere" });

const incidentSchema = new mongoose.Schema({
  incident_type: { type: String, required: true },
  description: { type: String },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  assigned_resource: { type: mongoose.Schema.Types.ObjectId, ref: "Resource" },
  status: { type: String, default: "reported" },
  reported_at: { type: Date, default: Date.now },
});

const Resource = mongoose.model("Resource", resourceSchema);
const Incident = mongoose.model("Incident", incidentSchema);

// API Routes

// Health check
app.get("/api/health", async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? "connected" : "disconnected";
  let collections: any[] = [];
  
  if (dbStatus === "connected") {
    try {
      const admin = mongoose.connection.db.admin();
      const dbInfo = await mongoose.connection.db.listCollections().toArray();
      for (const col of dbInfo) {
        const count = await mongoose.connection.db.collection(col.name).countDocuments();
        collections.push({ name: col.name, count });
      }
    } catch (e) {
      console.error("Error listing collections:", e);
    }
  }

  res.json({ 
    status: "ok", 
    database: dbStatus,
    db_name: mongoose.connection.name,
    collections,
    mongodb_uri_set: !!process.env.MONGODB_URI 
  });
});

// 1. Report an Incident
app.post(["/api/report-incident", "/report-incident"], checkDbConnection, async (req, res) => {
  const { incident_type, description, latitude, longitude } = req.body;

  if (!incident_type || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: "Missing required fields: incident_type, latitude, longitude" });
  }

  // Map incident type to resource type
  let requiredResourceType = "ambulance";
  if (incident_type.toLowerCase().includes("fire")) {
    requiredResourceType = "fire_truck";
  } else if (incident_type.toLowerCase().includes("accident") || incident_type.toLowerCase().includes("crime")) {
    requiredResourceType = "police";
  }

  try {
    // 1. Find the nearest available resource of the correct type
    const nearestResource = await Resource.findOne({
      type: requiredResourceType,
      available: true,
      location: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: 15000 // 15km
        },
      },
    });

    if (!nearestResource) {
      return res.status(404).json({ 
        error: `No available ${requiredResourceType.replace("_", " ")}s found nearby.`,
        tip: `Ensure you have seeded ${requiredResourceType}s and that they are available.`
      });
    }

    // 2. Assign resource and update availability
    nearestResource.available = false;
    await nearestResource.save();

    // 3. Save the incident
    const newIncident = new Incident({
      incident_type,
      description,
      location: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
      assigned_resource: nearestResource._id,
      status: "dispatched",
    });

    await newIncident.save();

    // 4. Notify the assigned resource via Socket.io
    io.to(nearestResource._id.toString()).emit("incident:assigned", {
      incident: newIncident,
      message: `New ${incident_type} incident assigned to you!`
    });

    res.status(201).json({
      message: `Incident reported and ${requiredResourceType.replace("_", " ")} assigned.`,
      incident: newIncident,
      assigned_resource: nearestResource,
    });
  } catch (error) {
    console.error("Error reporting incident:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 4. Resolve an Incident
app.post("/api/resolve-incident", checkDbConnection, async (req, res) => {
  const { incidentId } = req.body;

  if (!incidentId) {
    return res.status(400).json({ error: "Missing incidentId" });
  }

  try {
    const incident = await Incident.findById(incidentId);
    if (!incident) {
      return res.status(404).json({ error: "Incident not found" });
    }

    if (incident.status === "resolved") {
      return res.json({ message: "Incident already resolved" });
    }

    // 1. Update incident status
    incident.status = "resolved";
    await incident.save();

    // 2. Make the assigned resource available again
    if (incident.assigned_resource) {
      await Resource.findByIdAndUpdate(incident.assigned_resource, { available: true });
    }

    res.json({ message: "Incident resolved and resource is now available." });
  } catch (error) {
    console.error("Error resolving incident:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all resources
app.get("/api/resources", checkDbConnection, async (req, res) => {
  try {
    const resources = await Resource.find();
    res.json(resources);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch resources" });
  }
});

// Get all incidents
app.get("/api/incidents", checkDbConnection, async (req, res) => {
  try {
    const incidents = await Incident.find().populate("assigned_resource");
    res.json(incidents);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

// Get active incident for a specific resource
app.get("/api/active-incident/:resourceId", checkDbConnection, async (req, res) => {
  try {
    const { resourceId } = req.params;
    const incident = await Incident.findOne({
      assigned_resource: resourceId,
      status: "dispatched"
    });
    res.json(incident);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch active incident" });
  }
});

// Reset all resources to available
app.post("/api/reset-resources", checkDbConnection, async (req, res) => {
  try {
    await Resource.updateMany({}, { available: true });
    res.json({ message: "All resources reset to available." });
  } catch (error) {
    res.status(500).json({ error: "Failed to reset resources" });
  }
});

// Helper: Seed initial resources if none exist
app.post("/api/seed-resources", checkDbConnection, async (req, res) => {
  try {
    const count = await Resource.countDocuments();
    if (count > 0) {
      return res.json({ message: "Resources already seeded." });
    }

    const resources = [
      // Ambulances
      { type: "ambulance", location: { type: "Point", coordinates: [-122.4194, 37.7749] } },
      { type: "ambulance", location: { type: "Point", coordinates: [-122.4476, 37.7649] } },
      // Fire Trucks
      { type: "fire_truck", location: { type: "Point", coordinates: [-122.4011, 37.7944] } },
      { type: "fire_truck", location: { type: "Point", coordinates: [-122.4316, 37.7833] } },
      // Police Cars
      { type: "police", location: { type: "Point", coordinates: [-122.4111, 37.7858] } },
      { type: "police", location: { type: "Point", coordinates: [-122.4683, 37.7341] } },
    ];

    await Resource.insertMany(resources);
    res.json({ message: "Resources seeded successfully.", count: resources.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to seed resources" });
  }
});

// Vite middleware for development
async function startServer() {
  const isProduction = process.env.NODE_ENV === "production" || process.env.VITE_PROD === "true";
  console.log(`Starting server in ${isProduction ? "production" : "development"} mode (NODE_ENV=${process.env.NODE_ENV})`);

  if (!isProduction) {
    try {
      console.log("Starting Vite in development mode...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error("Failed to start Vite, falling back to static serving:", e);
      // Fallback to static if Vite fails
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else {
    const distPath = path.join(__dirname, "dist");
    console.log(`Serving static files from ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      res.sendFile(indexPath, (err) => {
        if (err) {
          console.error(`Error sending index.html from ${indexPath}:`, err);
          res.status(404).send("Application build not found. Please try again in a few moments.");
        }
      });
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
