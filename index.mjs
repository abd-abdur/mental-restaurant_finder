import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Parser } from "json2csv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Setup environment variables
dotenv.config();

// Convert ES module to use __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const API_KEY = process.env.SERPAPI_KEY;
const MIN_RATING = 4.0;
const MIN_REVIEWS = 100;
const RESULTS_PER_PAGE = 20;

async function getRestaurants(location) {
    console.log(`Searching for restaurants in: ${location}`);

    let url = `https://serpapi.com/search?engine=google_maps&q=restaurants+in+${encodeURIComponent(location)}&type=search&api_key=${API_KEY}`;
    console.log(`Fetching URL: ${url}`);

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
            console.error("SerpApi Error:", data.error);
            return { restaurants: [], ll: null };
        }

        const restaurants = data.local_results || [];
        if (restaurants.length === 0) {
            console.warn("No restaurants found in API response.");
            return { restaurants: [], ll: null };
        }

        console.log(`Found ${restaurants.length} restaurants.`);

        const firstRestaurant = restaurants[0];
        if (!firstRestaurant.gps_coordinates) {
            console.warn("No GPS coordinates found for the first restaurant.");
            return { restaurants, ll: null };
        }

        const { latitude, longitude } = firstRestaurant.gps_coordinates;
        const ll = `@${latitude},${longitude},14z`;

        return { restaurants, ll };
    } catch (error) {
        console.error("Error fetching restaurants:", error);
        return { restaurants: [], ll: null };
    }
}

async function fetchAllRestaurants(location) {
    let { restaurants, ll } = await getRestaurants(location);

    if (!ll) {
        console.warn("No 'll' parameter found. Cannot proceed with pagination.");
        return [];
    }

    let allRestaurants = [...restaurants];
    let start = RESULTS_PER_PAGE;

    while (true) {
        console.log(`Fetching more results (start=${start})...`);

        let url = `https://serpapi.com/search?engine=google_maps&q=restaurants+in+${encodeURIComponent(location)}&ll=${ll}&type=search&start=${start}&api_key=${API_KEY}`;
        console.log(`Pagination URL: ${url}`);

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                console.warn("No more pages or API limit reached:", data.error);
                break;
            }

            const newResults = data.local_results || [];
            console.log(`Retrieved ${newResults.length} additional restaurants.`);

            if (newResults.length === 0) break;

            allRestaurants.push(...newResults);
            start += RESULTS_PER_PAGE;
        } catch (error) {
            console.error("Error during pagination:", error);
            break;
        }
    }

    return allRestaurants;
}

// Serve the homepage with a search form
app.get("/", (req, res) => {
    res.send(`
        <html>
            <head>
                <script src="https://cdn.tailwindcss.com"></script>
            </head>
            <body class="bg-gray-100 text-center p-10">
                <h1 class="text-3xl font-bold text-blue-600">Restaurant Finder</h1>
                <p class="mt-4 text-lg">Find top-rated restaurants in your desired location.</p>
                <form action="/restaurants" method="GET" class="mt-5">
                    <input type="text" name="q" placeholder="Enter location" class="p-2 border rounded" required>
                    <button type="submit" class="ml-2 bg-blue-600 text-white p-2 rounded">Search</button>
                </form>
            </body>
        </html>
    `);
});

// Fetch restaurants and display results
app.get("/restaurants", async (req, res) => {
    const location = req.query.q;
    if (!location) {
        return res.status(400).send("Missing 'q' parameter. Example: /restaurants?q=Saadiyat Island");
    }

    const restaurants = await fetchAllRestaurants(location);
    const filteredRestaurants = restaurants.filter(r => (r.rating || 0) >= MIN_RATING && (r.reviews || 0) >= MIN_REVIEWS);

    if (filteredRestaurants.length === 0) {
        return res.send("<h3>No high-rated restaurants found.</h3>");
    }

    // Save to CSV
    const csvFilePath = path.join(__dirname, "restaurants.csv");
    const csvFields = ["title", "address", "rating", "reviews", "phone", "gps_coordinates"];
    const csvParser = new Parser({ fields: csvFields });
    const csvData = csvParser.parse(filteredRestaurants.map(r => ({
        title: r.title,
        address: r.address,
        rating: r.rating,
        reviews: r.reviews,
        phone: r.phone || "No contact info",
        gps_coordinates: r.gps_coordinates ? `${r.gps_coordinates.latitude}, ${r.gps_coordinates.longitude}` : "No coordinates"
    })));

    fs.writeFileSync(csvFilePath, csvData);

    let resultHTML = `
        <html>
            <head><script src="https://cdn.tailwindcss.com"></script></head>
            <body class="bg-blue-600 text-white flex flex-col items-center py-10">
                <h2 class="text-4xl font-bold">Top Restaurants in ${location}</h2>
                <a href="/download" class="bg-yellow-400 text-black px-6 py-2 rounded font-bold mt-4">Download CSV</a>
                <ul class="bg-white text-black w-2/3 mt-6 p-6 rounded shadow-md">`;

    filteredRestaurants.forEach(restaurant => {
        resultHTML += `
                <li class="border-b py-3">
                    <strong>${restaurant.title}</strong><br>
                    Rating: ${restaurant.rating} (${restaurant.reviews} reviews)<br>
                    Contact: ${restaurant.phone ? restaurant.phone : "No contact info available"}<br>
                    <a href="https://www.google.com/maps/search/?api=1&query=${restaurant.gps_coordinates.latitude},${restaurant.gps_coordinates.longitude}" target="_blank" class="text-blue-500">View on Map</a>
                </li>`;
    });

    resultHTML += `</ul><br><a href="/" class="bg-yellow-400 text-black px-6 py-2 rounded font-bold">Back</a></body></html>`;

    res.send(resultHTML);
});

// Endpoint to download the CSV file
app.get("/download", (req, res) => {
    const csvFilePath = path.join(__dirname, "restaurants.csv");
    res.download(csvFilePath, "restaurants.csv", err => {
        if (err) {
            console.error("Error downloading file:", err);
            res.status(500).send("Error downloading file.");
        }
    });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
