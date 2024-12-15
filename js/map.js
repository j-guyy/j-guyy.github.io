document.addEventListener('DOMContentLoaded', function () {
    createCombinedMap();
    displayHighPointsList();
});

function createCombinedMap() {
    const width = 960;
    const height = 600;

    const svg = d3.select("#combined-map")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const projection = d3.geoAlbersUsa()
        .translate([width / 2, height / 2])
        .scale(1200);

    const path = d3.geoPath().projection(projection);

    // Create a tooltip div
    const tooltip = d3.select("#combined-map").append("div")
        .attr("class", "tooltip")
        .style("opacity", 0)
        .style("position", "absolute")
        .style("pointer-events", "none");

    // Load US map data
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
        .then(function (us) {
            svg.append("g")
                .selectAll("path")
                .data(topojson.feature(us, us.objects.states).features)
                .enter().append("path")
                .attr("class", "state")
                .attr("d", path);

            // Add metros (circles)
            svg.selectAll(".city-dot")
                .data(cities)
                .enter().append("circle")
                .attr("class", d => `city-dot ${d.visited ? 'visited' : 'not-visited'}`)
                .attr("cx", d => projection(d.coords)[0])
                .attr("cy", d => projection(d.coords)[1])
                .attr("r", 5)
                .on("mouseover", function (event, d) {
                    handleMouseOver(this, event, d, tooltip, 'metro');
                })
                .on("mouseout", function () {
                    handleMouseOut(this, tooltip, 'metro');
                })
                .on("click", function (event, d) {
                    handleClick(d, 'metro');
                });

            // Add high points (triangles)
            svg.selectAll(".high-point-triangle")
                .data(highPoints)
                .enter().append("path")
                .attr("class", d => `high-point-triangle ${d.visited ? 'visited' : 'not-visited'}`)
                .attr("d", d3.symbol().type(d3.symbolTriangle).size(100))
                .attr("transform", d => `translate(${projection(d.coords)})`)
                .on("mouseover", function (event, d) {
                    handleMouseOver(this, event, d, tooltip, 'highpoint');
                })
                .on("mouseout", function () {
                    handleMouseOut(this, tooltip, 'highpoint');
                })
                .on("click", function (event, d) {
                    handleClick(d, 'highpoint');
                });
            createLegend();
        })
        .catch(function (error) {
            console.error("Error loading or parsing data:", error);
            document.getElementById("combined-map").innerHTML = "Error loading map. Please try again later.";
        });
}

function handleMouseOver(element, event, d, tooltip, type) {
    if (type === 'metro') {
        d3.select(element).attr("r", 8);
    } else if (type === 'highpoint') {
        d3.select(element).attr("d", d3.symbol().type(d3.symbolTriangle).size(200));
    }

    tooltip.transition()
        .duration(200)
        .style("opacity", .9);

    let tooltipContent = type === 'metro'
        ? `<strong>${d.name}, ${d.state}</strong><br/>${d.visited ? 'Visited' : 'Not visited'}`
        : `<strong>${d.state}: ${d.name}</strong><br/>${d.elevation} ft<br/>${d.visited ? 'Summited' : 'Not summited'}`;

    tooltip.html(tooltipContent)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 28) + "px");
}

function handleMouseOut(element, tooltip, type) {
    if (type === 'metro') {
        d3.select(element).attr("r", 5);
    } else if (type === 'highpoint') {
        d3.select(element).attr("d", d3.symbol().type(d3.symbolTriangle).size(100));
    }

    tooltip.transition()
        .duration(500)
        .style("opacity", 0);
}

function handleClick(d, type) {
    if (d.visited) {
        let url;
        if (type === 'metro') {
            url = `https://en.wikipedia.org/wiki/${encodeURIComponent(d.name)},_${d.state}`;
        } else if (type === 'highpoint') {
            const customUrls = {
                "UT": "https://en.wikipedia.org/wiki/Kings_Peak_(Utah)",
                "NM": "https://en.wikipedia.org/wiki/Wheeler_Peak_(New_Mexico)",
                "NV": "https://en.wikipedia.org/wiki/Boundary_Peak_(Nevada)",
                "MT": "https://en.wikipedia.org/wiki/Granite_Peak_(Montana)",
                "NH": "https://en.wikipedia.org/wiki/Mount_Washington_(New_Hampshire)",
                "OK": "https://en.wikipedia.org/wiki/Black_Mesa_(Oklahoma)",
                "KY": "https://en.wikipedia.org/wiki/Black_Mountain_(Kentucky)",
                "PA": "https://en.wikipedia.org/wiki/Mount_Davis_(Pennsylvania)",
                "MN": "https://en.wikipedia.org/wiki/Eagle_Mountain_(Minnesota)",
                "NJ": "https://en.wikipedia.org/wiki/High_Point_(New_Jersey)",
                "OH": "https://en.wikipedia.org/wiki/Campbell_Hill_(Ohio)",
            };

            if (customUrls[d.state]) {
                url = customUrls[d.state];
            } else {
                // Fallback for any highpoints not in the custom list
                url = `https://en.wikipedia.org/wiki/${encodeURIComponent(d.name)}`;
            }
        }
        window.open(url, '_blank');
    }
}


function displayHighPointsList() {
    const highPointsContainer = document.getElementById('high-points-container');

    // Sort high points by elevation (highest to lowest)
    const sortedHighPoints = highPoints.sort((a, b) => b.elevation - a.elevation);

    // Create the table
    const table = document.createElement('table');
    table.className = 'high-points-table';

    // Create table header
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Status</th>
            <th>Rank</th>
            <th>Peak Name</th>
            <th>State</th>
            <th>Elevation (ft)</th>
        </tr>
    `;
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    sortedHighPoints.forEach((point, index) => {
        const row = document.createElement('tr');
        row.className = point.visited ? 'visited' : 'not-visited';
        row.innerHTML = `
            <td>${point.visited ? '✅' : '⬜'}</td>
            <td>${index + 1}</td>
            <td>${point.name}</td>
            <td>${point.state}</td>
            <td>${point.elevation.toLocaleString()}</td>
        `;
        tbody.appendChild(row);
    });
    table.appendChild(tbody);

    highPointsContainer.appendChild(table);
}

function createLegend() {
    const legend = d3.select("#map-legend")
        .append("svg")
        .attr("width", 180)
        .attr("height", 100);

    const legendData = [
        { shape: "circle", color: "#4CAF50", label: "Metro - Visited" },
        { shape: "circle", color: "#f44336", label: "Metro - Not Visited" },
        { shape: "triangle", color: "#4CAF50", label: "High Point - Summited" },
        { shape: "triangle", color: "#f44336", label: "High Point - Not Summited" }
    ];

    const legendItems = legend.selectAll(".legend-item")
        .data(legendData)
        .enter().append("g")
        .attr("class", "legend-item")
        .attr("transform", (d, i) => `translate(5, ${i * 25 + 5})`);

    legendItems.each(function (d) {
        const g = d3.select(this);

        if (d.shape === "circle") {
            g.append("circle")
                .attr("cx", 8)
                .attr("cy", 8)
                .attr("r", 5)
                .style("fill", d.color);
        } else if (d.shape === "triangle") {
            g.append("path")
                .attr("d", d3.symbol().type(d3.symbolTriangle).size(50))
                .attr("transform", "translate(8, 8)")
                .style("fill", d.color);
        }

        g.append("text")
            .attr("x", 20)
            .attr("y", 12)
            .text(d.label)
            .style("font-size", "10px")
            .attr("alignment-baseline", "middle");
    });
}

// Define your visited and not visited cities
const cities = [
    { name: "New York City", state: "NY", coords: [-74.006, 40.7128], visited: true },
    { name: "Los Angeles", state: "CA", coords: [-118.2437, 34.0522], visited: true },
    { name: "Chicago", state: "IL", coords: [-87.6298, 41.8781], visited: true },
    { name: "Dallas", state: "TX", coords: [-96.7970, 32.7767], visited: true },
    { name: "Houston", state: "TX", coords: [-95.3698, 29.7604], visited: true },
    { name: "Atlanta", state: "GA", coords: [-84.3880, 33.7490], visited: true },
    { name: "Washington DC", state: "DC", coords: [-77.0369, 38.9072], visited: true },
    { name: "Philadelphia", state: "PA", coords: [-75.1652, 39.9526], visited: true },
    { name: "Miami", state: "FL", coords: [-80.1918, 25.7617], visited: true },
    { name: "Phoenix", state: "AZ", coords: [-112.0740, 33.4484], visited: true },
    { name: "Boston", state: "MA", coords: [-71.0589, 42.3601], visited: true },
    { name: "Riverside", state: "CA", coords: [-117.3961, 33.9806], visited: true },
    { name: "San Francisco", state: "CA", coords: [-122.4194, 37.7749], visited: true },
    { name: "Detroit", state: "MI", coords: [-83.0458, 42.3314], visited: true },
    { name: "Seattle", state: "WA", coords: [-122.3321, 47.6062], visited: true },
    { name: "Tampa", state: "FL", coords: [-82.4572, 27.9506], visited: true },
    { name: "San Diego", state: "CA", coords: [-117.1611, 32.7157], visited: true },
    { name: "Denver", state: "CO", coords: [-104.9903, 39.7392], visited: true },
    { name: "Baltimore", state: "MD", coords: [-76.6122, 39.2904], visited: true },
    { name: "Orlando", state: "FL", coords: [-81.3792, 28.5383], visited: true },
    { name: "Charlotte", state: "NC", coords: [-80.8431, 35.2271], visited: true },
    { name: "San Antonio", state: "TX", coords: [-98.4936, 29.4241], visited: true },
    { name: "Portland", state: "OR", coords: [-122.6784, 45.5152], visited: true },
    { name: "Austin", state: "TX", coords: [-97.7431, 30.2672], visited: true },
    { name: "Pittsburgh", state: "PA", coords: [-79.9959, 40.4406], visited: true },
    { name: "Las Vegas", state: "NV", coords: [-115.1398, 36.1699], visited: true },
    { name: "Cincinnati", state: "OH", coords: [-84.5120, 39.1031], visited: true },
    { name: "Columbus", state: "OH", coords: [-82.9988, 39.9612], visited: true },
    { name: "Cleveland", state: "OH", coords: [-81.6944, 41.4993], visited: true },
    { name: "Nashville", state: "TN", coords: [-86.7816, 36.1627], visited: true },
    { name: "San Jose", state: "CA", coords: [-121.8863, 37.3382], visited: true },
    { name: "Virginia Beach", state: "VA", coords: [-75.9780, 36.8529], visited: true },
    { name: "Raleigh", state: "NC", coords: [-78.6382, 35.7796], visited: true },
    { name: "Oklahoma City", state: "OK", coords: [-97.5164, 35.4676], visited: true },
    { name: "Richmond", state: "VA", coords: [-77.4360, 37.5407], visited: true },
    { name: "Salt Lake City", state: "UT", coords: [-111.8910, 40.7608], visited: true },
    { name: "Buffalo", state: "NY", coords: [-78.8784, 42.8864], visited: true },
    { name: "Tucson", state: "AZ", coords: [-110.9265, 32.2226], visited: true },
    { name: "Rochester", state: "NY", coords: [-77.6109, 43.1566], visited: true },
    { name: "Tulsa", state: "OK", coords: [-95.9928, 36.1540], visited: true },
    { name: "Greenville", state: "SC", coords: [-82.3940, 34.8526], visited: true },
    { name: "New Orleans", state: "LA", coords: [-90.0715, 29.9511], visited: true },
    { name: "Knoxville", state: "TN", coords: [-83.9207, 35.9606], visited: true },
    { name: "Albuquerque", state: "NM", coords: [-106.6504, 35.0844], visited: true },
    { name: "Sarasota", state: "FL", coords: [-82.5308, 27.3364], visited: true },
    { name: "Albany", state: "NY", coords: [-73.7562, 42.6526], visited: true },
    { name: "Baton Rouge", state: "LA", coords: [-91.1403, 30.4515], visited: true },
    { name: "Allentown", state: "PA", coords: [-75.4902, 40.6084], visited: true },
    { name: "El Paso", state: "TX", coords: [-106.4850, 31.7619], visited: true },
    { name: "Columbia", state: "SC", coords: [-81.0348, 34.0007], visited: true },
    { name: "Oxnard", state: "CA", coords: [-119.1792, 34.1975], visited: true },
    { name: "Boise", state: "ID", coords: [-116.2023, 43.6150], visited: true },
    { name: "Dayton", state: "OH", coords: [-84.1916, 39.7589], visited: true },
    { name: "Greensboro", state: "NC", coords: [-79.7920, 36.0726], visited: true },
    { name: "Colorado Springs", state: "CO", coords: [-104.8214, 38.8339], visited: true },
    { name: "Little Rock", state: "AR", coords: [-92.2896, 34.7465], visited: true },
    { name: "Provo", state: "UT", coords: [-111.6585, 40.2338], visited: true },
    { name: "Poughkeepsie", state: "NY", coords: [-73.9215, 41.7066], visited: true },
    { name: "Akron", state: "OH", coords: [-81.5190, 41.0814], visited: true },
    { name: "Winston-Salem", state: "NC", coords: [-80.2442, 36.0999], visited: true },
    { name: "Ogden", state: "UT", coords: [-111.9738, 41.2230], visited: true },
    { name: "Syracuse", state: "NY", coords: [-76.1474, 43.0481], visited: true },
    { name: "Durham", state: "NC", coords: [-78.8986, 35.9940], visited: true },
    { name: "Harrisburg", state: "PA", coords: [-76.8867, 40.2732], visited: true },
    { name: "Toledo", state: "OH", coords: [-83.5379, 41.6528], visited: true },

    { name: "Minneapolis", state: "MN", coords: [-93.2650, 44.9778], visited: false },
    { name: "St. Louis", state: "MO", coords: [-90.1994, 38.6270], visited: false },
    { name: "Sacramento", state: "CA", coords: [-121.4944, 38.5816], visited: false },
    { name: "Kansas City", state: "MO", coords: [-94.5786, 39.0997], visited: false },
    { name: "Jacksonville", state: "FL", coords: [-81.6557, 30.3322], visited: false },
    { name: "Providence", state: "RI", coords: [-71.4128, 41.8240], visited: false },
    { name: "Milwaukee", state: "WI", coords: [-87.9065, 43.0389], visited: false },
    { name: "Indianapolis", state: "IN", coords: [-86.1581, 39.7684], visited: false },
    { name: "Louisville", state: "KY", coords: [-85.7585, 38.2527], visited: false },
    { name: "Memphis", state: "TN", coords: [-90.0490, 35.1495], visited: false },
    { name: "Birmingham", state: "AL", coords: [-86.8025, 33.5186], visited: false },
    { name: "Fresno", state: "CA", coords: [-119.7871, 36.7378], visited: false },
    { name: "Grand Rapids", state: "MI", coords: [-85.6681, 42.9634], visited: false },
    { name: "Hartford", state: "CT", coords: [-72.6823, 41.7658], visited: false },
    { name: "Honolulu", state: "HI", coords: [-157.8583, 21.3069], visited: false },
    { name: "Omaha", state: "NE", coords: [-95.9345, 41.2565], visited: false },
    { name: "Bridgeport", state: "CT", coords: [-73.1952, 41.1865], visited: false },
    { name: "Bakersfield", state: "CA", coords: [-119.0187, 35.3733], visited: false },
    { name: "McAllen", state: "TX", coords: [-98.2300, 26.2034], visited: false },
    { name: "Worcester", state: "MA", coords: [-71.8023, 42.2626], visited: false },
    { name: "Charleston", state: "SC", coords: [-79.9311, 32.7765], visited: false },
    { name: "Cape Coral", state: "FL", coords: [-81.9495, 26.5629], visited: false },
    { name: "Lakeland", state: "FL", coords: [-81.9498, 28.0395], visited: false },
    { name: "Stockton", state: "CA", coords: [-121.2908, 37.9577], visited: false },
    { name: "Des Moines", state: "IA", coords: [-93.6091, 41.5868], visited: false },
    { name: "Deltona", state: "FL", coords: [-81.2636, 28.9005], visited: false },
    { name: "Madison", state: "WI", coords: [-89.4012, 43.0731], visited: false },
    { name: "Wichita", state: "KS", coords: [-97.3375, 37.6872], visited: false },
    { name: "Palm Bay", state: "FL", coords: [-80.5887, 28.0345], visited: false },
    { name: "Augusta", state: "GA", coords: [-82.0107, 33.4735], visited: false },
    { name: "Jackson", state: "MS", coords: [-90.1848, 32.2988], visited: false },
    { name: "Spokane", state: "WA", coords: [-117.4260, 47.6588], visited: false },
    { name: "Fayetteville", state: "AR", coords: [-94.1574, 36.0626], visited: false },
    { name: "Chattanooga", state: "TN", coords: [-85.3097, 35.0456], visited: false },
    { name: "Scranton", state: "PA", coords: [-75.6624, 41.4090], visited: false }
];

const highPoints = [
    { state: "AK", name: "Denali", elevation: 20310, visited: false, coords: [-151.0063, 63.0695] },
    { state: "CA", name: "Mount Whitney", elevation: 14494, visited: false, coords: [-118.2922, 36.5785] },
    { state: "CO", name: "Mount Elbert", elevation: 14433, visited: false, coords: [-106.4454, 39.1178] },
    { state: "WA", name: "Mount Rainier", elevation: 14411, visited: false, coords: [-121.7603, 46.8523] },
    { state: "WY", name: "Gannett Peak", elevation: 13804, visited: false, coords: [-109.6542, 43.1842] },
    { state: "HI", name: "Mauna Kea", elevation: 13803, visited: false, coords: [-155.4682, 19.8207] },
    { state: "UT", name: "Kings Peak", elevation: 13528, visited: false, coords: [-110.3729, 40.7764] },
    { state: "NM", name: "Wheeler Peak", elevation: 13161, visited: true, coords: [-105.4172, 36.5568] },
    { state: "NV", name: "Boundary Peak", elevation: 13140, visited: false, coords: [-118.3513, 37.8462] },
    { state: "MT", name: "Granite Peak", elevation: 12799, visited: false, coords: [-110.1072, 45.1633] },
    { state: "ID", name: "Borah Peak", elevation: 12662, visited: false, coords: [-113.7811, 44.1374] },
    { state: "AZ", name: "Humphreys Peak", elevation: 12633, visited: true, coords: [-111.6781, 35.3464] },
    { state: "OR", name: "Mount Hood", elevation: 11239, visited: true, coords: [-121.6959, 45.3735] },
    { state: "TX", name: "Guadalupe Peak", elevation: 8749, visited: true, coords: [-104.8606, 31.8914] },
    { state: "SD", name: "Black Elk Peak", elevation: 7242, visited: true, coords: [-103.7516, 43.8662] },
    { state: "NC", name: "Mount Mitchell", elevation: 6684, visited: true, coords: [-82.2656, 35.7648] },
    { state: "TN", name: "Clingmans Dome", elevation: 6643, visited: true, coords: [-83.4985, 35.5629] },
    { state: "NH", name: "Mount Washington", elevation: 6288, visited: false, coords: [-71.3033, 44.2705] },
    { state: "VA", name: "Mount Rogers", elevation: 5729, visited: true, coords: [-81.5447, 36.6597] },
    { state: "NE", name: "Panorama Point", elevation: 5424, visited: true, coords: [-104.0317, 41.0037] },
    { state: "NY", name: "Mount Marcy", elevation: 5344, visited: true, coords: [-73.9237, 44.1121] },
    { state: "ME", name: "Mount Katahdin", elevation: 5268, visited: false, coords: [-68.9214, 45.9044] },
    { state: "OK", name: "Black Mesa", elevation: 4973, visited: true, coords: [-102.9972, 36.9317] },
    { state: "WV", name: "Spruce Knob", elevation: 4863, visited: true, coords: [-79.5312, 38.6998] },
    { state: "GA", name: "Brasstown Bald", elevation: 4784, visited: false, coords: [-83.8107, 34.8740] },
    { state: "VT", name: "Mount Mansfield", elevation: 4393, visited: true, coords: [-72.8143, 44.5437] },
    { state: "KY", name: "Black Mountain", elevation: 4145, visited: true, coords: [-82.8940, 36.9143] },
    { state: "KS", name: "Mount Sunflower", elevation: 4039, visited: false, coords: [-102.0372, 39.0219] },
    { state: "ND", name: "White Butte", elevation: 3506, visited: false, coords: [-103.3048, 46.3863] },
    { state: "MA", name: "Mount Greylock", elevation: 3489, visited: true, coords: [-73.1662, 42.6376] },
    { state: "SC", name: "Sassafras Mountain", elevation: 3553, visited: true, coords: [-82.7770, 35.0647] },
    { state: "MD", name: "Hoye-Crest", elevation: 3360, visited: true, coords: [-79.4876, 39.2383] },
    { state: "PA", name: "Mount Davis", elevation: 3213, visited: true, coords: [-79.1347, 39.7861] },
    { state: "AR", name: "Magazine Mountain", elevation: 2753, visited: false, coords: [-93.6452, 35.1671] },
    { state: "AL", name: "Cheaha Mountain", elevation: 2407, visited: false, coords: [-85.8086, 33.4857] },
    { state: "CT", name: "Mount Frissell-South Slope", elevation: 2380, visited: true, coords: [-73.4834, 42.0497] },
    { state: "MN", name: "Eagle Mountain", elevation: 2301, visited: false, coords: [-90.5598, 47.8974] },
    { state: "MI", name: "Mount Arvon", elevation: 1979, visited: false, coords: [-88.1553, 46.7564] },
    { state: "WI", name: "Timms Hill", elevation: 1951, visited: false, coords: [-90.1953, 45.4519] },
    { state: "NJ", name: "High Point", elevation: 1803, visited: false, coords: [-74.6615, 41.3208] },
    { state: "MO", name: "Taum Sauk Mountain", elevation: 1772, visited: false, coords: [-90.7279, 37.5719] },
    { state: "IA", name: "Hawkeye Point", elevation: 1670, visited: false, coords: [-95.7083, 43.4602] },
    { state: "OH", name: "Campbell Hill", elevation: 1550, visited: true, coords: [-83.7201, 40.3698] },
    { state: "IN", name: "Hoosier Hill", elevation: 1257, visited: true, coords: [-84.8519, 39.9478] },
    { state: "IL", name: "Charles Mound", elevation: 1235, visited: false, coords: [-90.2394, 42.5045] },
    { state: "RI", name: "Jerimoth Hill", elevation: 812, visited: false, coords: [-71.7789, 41.8507] },
    { state: "MS", name: "Woodall Mountain", elevation: 807, visited: false, coords: [-88.2413, 34.7880] },
    { state: "LA", name: "Driskill Mountain", elevation: 535, visited: false, coords: [-92.8972, 32.4251] },
    { state: "DE", name: "Ebright Azimuth", elevation: 448, visited: true, coords: [-75.5220, 39.8362] },
    { state: "FL", name: "Britton Hill", elevation: 345, visited: false, coords: [-86.2814, 30.9833] }
];
