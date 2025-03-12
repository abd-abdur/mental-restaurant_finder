import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config();

// Convert ES module to use __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SERPAPI_KEY;
const MIN_RATING = 4.0;
const MIN_REVIEWS = 100;
const RESULTS_PER_PAGE = 20;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Fetch restaurants from SerpAPI
async function getRestaurants(location) {
    console.log(`Searching for restaurants in: ${location}`);
    let url = `https://serpapi.com/search?engine=google_maps&q=restaurants+in+${encodeURIComponent(location)}&type=search&api_key=${API_KEY}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error || !data.local_results) {
            console.error("SerpApi Error or No results found:", data.error);
            return { restaurants: [], ll: null };
        }

        const firstRestaurant = data.local_results[0] || {};
        const ll = firstRestaurant.gps_coordinates 
            ? `@${firstRestaurant.gps_coordinates.latitude},${firstRestaurant.gps_coordinates.longitude},14z`
            : null;

        return { restaurants: data.local_results, ll };
    } catch (error) {
        console.error("Error fetching restaurants:", error);
        return { restaurants: [], ll: null };
    }
}

// Fetch paginated restaurant data
async function fetchAllRestaurants(location) {
    let { restaurants, ll } = await getRestaurants(location);
    let allRestaurants = [...restaurants];
    let start = RESULTS_PER_PAGE;

    while (ll) {
        console.log(`Fetching more results (start=${start})...`);
        let url = `https://serpapi.com/search?engine=google_maps&q=restaurants+in+${encodeURIComponent(location)}&ll=${ll}&type=search&start=${start}&api_key=${API_KEY}`;
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (!data.local_results) break;

            allRestaurants.push(...data.local_results);
            start += RESULTS_PER_PAGE;
        } catch (error) {
            console.error("Error during pagination:", error);
            break;
        }
    }

    return allRestaurants;
}

// Serve homepage
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Fetch and display restaurants
app.get("/restaurants", async (req, res) => {
    const location = req.query.q;
    if (!location) return res.status(400).send("Missing 'q' parameter.");

    const restaurants = await fetchAllRestaurants(location);
    const filteredRestaurants = restaurants.filter(r => (r.rating || 0) >= MIN_RATING && (r.reviews || 0) >= MIN_REVIEWS);
    
    if (filteredRestaurants.length === 0) {
        return res.send("<h3>No high-rated restaurants found.</h3>");
    }

    // Save to CSV
    const csvFilePath = path.join(__dirname, "restaurants.csv");
    const csvParser = new Parser({ fields: ["title", "address", "rating", "reviews", "phone", "gps_coordinates"] });
    const csvData = csvParser.parse(filteredRestaurants.map(r => ({
        title: r.title,
        address: r.address,
        rating: r.rating,
        reviews: r.reviews,
        phone: r.phone || "No contact info",
        gps_coordinates: r.gps_coordinates 
            ? `${r.gps_coordinates.latitude}, ${r.gps_coordinates.longitude}` 
            : "No coordinates"
    })));

    fs.writeFileSync(csvFilePath, csvData);
    res.sendFile(csvFilePath);
});

// Endpoint to download CSV
app.get("/download", (req, res) => {
    res.download(path.join(__dirname, "restaurants.csv"), "restaurants.csv");
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
