document.addEventListener('DOMContentLoaded', function () {
    createCombinedMap();
    displayTravelSummary();
    setupToggleButtons();
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
                .attr("class", d => {
                    const stateName = d.properties.name;
                    return `state ${visitedStates[stateName] ? 'visited' : 'not-visited'}`;
                })
                .attr("d", path);

            // Add metros (circles)
            const allMetros = [...cities, ...additionalMetros];
            svg.selectAll(".city-dot")
                .data(allMetros)
                .enter().append("circle")
                .attr("class", d => `city-dot ${d.visited ? 'visited' : 'not-visited'} ${cities.includes(d) ? 'top-100' : 'top-200'}`)
                .attr("cx", d => projection(d.coords)[0])
                .attr("cy", d => projection(d.coords)[1])
                .style("display", d => cities.includes(d) ? null : 'none') // Hide additional metros by default
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

            // Add national parks (squares)
            svg.selectAll(".national-park-square")
                .data(nationalParks)
                .enter().append("rect")
                .attr("class", d => `national-park-square ${d.visited ? 'visited' : 'not-visited'}`)
                .attr("x", d => projection(d.coords)[0] - 5)
                .attr("y", d => projection(d.coords)[1] - 5)
                .attr("width", 10)
                .attr("height", 10)
                .on("mouseover", function (event, d) {
                    handleMouseOver(this, event, d, tooltip, 'park');
                })
                .on("mouseout", function () {
                    handleMouseOut(this, tooltip, 'park');
                })
                .on("click", function (event, d) {
                    handleClick(d, 'park');
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
    } else if (type === 'highpoint') {
        d3.select(element).attr("d", d3.symbol().type(d3.symbolTriangle).size(200));
    } else if (type === 'park') {
        d3.select(element)
            .attr("width", 15)
            .attr("height", 15)
            .attr("x", function () {
                return parseFloat(d3.select(this).attr("x")) - 2.5;
            })
            .attr("y", function () {
                return parseFloat(d3.select(this).attr("y")) - 2.5;
            });
    }

    tooltip.transition()
        .duration(200)
        .style("opacity", .9);

    let tooltipContent = type === 'metro'
        ? `<strong>${d.name}, ${d.state}</strong><br/>${d.visited ? 'Visited' : 'Not visited'}`
        : type === 'highpoint'
            ? `<strong>${d.state}: ${d.name}</strong><br/>${d.elevation} ft<br/>${d.visited ? 'Summited' : 'Not summited'}`
            : `<strong>${d.name} NP</strong><br/>${d.state}<br/>${d.visited ? 'Visited' : 'Not visited'}`;

    tooltip.html(tooltipContent)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 28) + "px");
}

function handleMouseOut(element, tooltip, type) {
    if (type === 'metro') {
    } else if (type === 'highpoint') {
        d3.select(element).attr("d", d3.symbol().type(d3.symbolTriangle).size(100));
    } else if (type === 'park') {
        d3.select(element)
            .attr("width", 10)
            .attr("height", 10)
            .attr("x", function () {
                return parseFloat(d3.select(this).attr("x")) + 2.5;
            })
            .attr("y", function () {
                return parseFloat(d3.select(this).attr("y")) + 2.5;
            });
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
        } else if (type === 'park') {
            url = `https://en.wikipedia.org/wiki/${encodeURIComponent(d.name)}_National_Park`;
        }
        window.open(url, '_blank');
    }
}


function displayTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableContainer = document.getElementById('travel-table-container');
    const tableSelector = document.getElementById('table-selector');

    // Calculate summary statistics
    const stateCount = Object.values(visitedStates).filter(visited => visited).length;
    const statePercentage = ((stateCount / 50) * 100).toFixed(0);
    const metroCount = cities.filter(city => city.visited).length;
    const metroPercentage = ((metroCount / cities.length) * 100).toFixed(0);
    const highPointCount = highPoints.filter(point => point.visited).length;
    const highPointPercentage = ((highPointCount / 50) * 100).toFixed(0);
    const parkCount = nationalParks.filter(park => park.visited).length;
    const parkPercentage = ((parkCount / nationalParks.length) * 100).toFixed(0);

    // Display summary statistics
    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat states-summary">
                <div class="stat-number-container">
                    <span class="stat-number">${stateCount}</span>
                    <span class="stat-total">/50</span>
                    <span class="stat-percentage">(${statePercentage}%)</span>
                </div>
                <span class="stat-label">States Visited</span>
            </div>
            <div class="other-stats">
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${metroCount}</span>
                        <span class="stat-total">/${cities.length}</span>
                        <span class="stat-percentage">(${metroPercentage}%)</span>
                    </div>
                    <span class="stat-label">Largest Metros Visited</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${highPointCount}</span>
                        <span class="stat-total">/50</span>
                        <span class="stat-percentage">(${highPointPercentage}%)</span>
                    </div>
                    <span class="stat-label">High Points Summited</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${parkCount}</span>
                        <span class="stat-total">/${nationalParks.length}</span>
                        <span class="stat-percentage">(${parkPercentage}%)</span>
                    </div>
                    <span class="stat-label">National Parks Visited</span>
                </div>
            </div>
        </div>
    `;

    // Set up event listener for table selector
    tableSelector.addEventListener('change', function () {
        updateTable(this.value);
    });

    // Initial table display
    updateTable('highpoints');
}

function updateTable(tableType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = ''; // Clear previous table

    const table = document.createElement('table');
    table.className = 'travel-table';

    let tableData, tableHeaders;

    if (tableType === 'highpoints') {
        tableHeaders = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
        tableData = highPoints.sort((a, b) => b.elevation - a.elevation);
    } else if (tableType === 'metros') {
        tableHeaders = ['Rank', 'Metro Area', 'State', 'Population', 'Status'];
        tableData = cities.map(city => {
            const metroData = metroStats.find(m => m.shortName === city.name);
            return {
                ...city,
                rank: metroData ? metroData.rank : 'N/A',
                population: metroData ? metroData.population : 'N/A',
                fullName: metroData ? metroData.name : city.name
            };
        }).sort((a, b) => (a.rank === 'N/A' ? Infinity : a.rank) - (b.rank === 'N/A' ? Infinity : b.rank));
    } else if (tableType === 'parks') {
        tableHeaders = ['National Park', 'State', 'Status'];
        tableData = nationalParks.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Create table header
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>${tableHeaders.map(header => `<th>${header}</th>`).join('')}</tr>`;
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    tableData.forEach((item, index) => {
        const row = document.createElement('tr');
        row.className = item.visited ? 'visited' : 'not-visited';

        if (tableType === 'highpoints') {
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${item.name}</td>
                <td>${item.state}</td>
                <td>${item.elevation.toLocaleString()}</td>
                <td>${item.visited ? '✅' : '⬜'}</td>
            `;
        } else if (tableType === 'metros') {
            row.innerHTML = `
                <td>${item.rank}</td>
                <td>${item.fullName}</td>
                <td>${item.state}</td>
                <td>${item.population}</td>
                <td>${item.visited ? '✅' : '⬜'}</td>
            `;
        } else if (tableType === 'parks') {
            row.innerHTML = `
                <td>${item.name}</td>
                <td>${item.state}</td>
                <td>${item.visited ? '✅' : '⬜'}</td>
            `;
        }

        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
}

function createLegend() {
    const legend = d3.select("#map-legend")
        .append("svg")
        .attr("width", 180)
        .attr("height", 200);

    const legendData = [
        { shape: "circle", color: "#4CAF50", label: "Metro - Visited", category: "Metro" },
        { shape: "circle", color: "#f44336", label: "Metro - Not Visited", category: "Metro" },
        { shape: "triangle", color: "#4CAF50", label: "High Point - Summited", category: "High Point" },
        { shape: "triangle", color: "#f44336", label: "High Point - Not Summited", category: "High Point" },
        { shape: "square", color: "#4CAF50", label: "National Park - Visited", category: "National Park" },
        { shape: "square", color: "#f44336", label: "National Park - Not Visited", category: "National Park" }
    ];

    const legendItems = legend.selectAll(".legend-item")
        .data(legendData)
        .enter().append("g")
        .attr("class", "legend-item")
        .attr("data-category", d => d.category)
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
        } else if (d.shape === "square") {
            g.append("rect")
                .attr("x", 3)
                .attr("y", 3)
                .attr("width", 10)
                .attr("height", 10)
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

function setupToggleButtons() {
    document.getElementById('toggle-metros').addEventListener('click', () => toggleCategory('city-dot.top-100', 'toggle-metros', 'Top 100 Metros'));
    document.getElementById('toggle-additional-metros').addEventListener('click', () => toggleCategory('city-dot.top-200', 'toggle-additional-metros', 'Additional Metros'));
    document.getElementById('toggle-highpoints').addEventListener('click', () => toggleCategory('high-point-triangle', 'toggle-highpoints', 'High Points'));
    document.getElementById('toggle-parks').addEventListener('click', () => toggleCategory('national-park-square', 'toggle-parks', 'National Parks'));

    // Set initial state for additional metros button
    updateButtonState(document.getElementById('toggle-additional-metros'), false, 'Additional Metros');
}

function toggleCategory(className, buttonId, categoryName) {
    const elements = document.querySelectorAll(`.${className}`);
    const button = document.getElementById(buttonId);
    const isVisible = window.getComputedStyle(elements[0]).display !== 'none';

    elements.forEach(element => {
        element.style.display = isVisible ? 'none' : '';
    });

    updateButtonState(button, !isVisible, categoryName);
}



function updateButtonState(button, isVisible, categoryName) {
    if (isVisible) {
        button.classList.remove('inactive');
        button.textContent = `Hide ${categoryName}`;
    } else {
        button.classList.add('inactive');
        button.textContent = `Show ${categoryName}`;
    }
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
    { name: "Hartford", state: "CT", coords: [-72.6823, 41.7658], visited: true },
    { name: "Honolulu", state: "HI", coords: [-157.8583, 21.3069], visited: false },
    { name: "Omaha", state: "NE", coords: [-95.9345, 41.2565], visited: false },
    { name: "Bridgeport", state: "CT", coords: [-73.1952, 41.1865], visited: true },
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
    { name: "Scranton", state: "PA", coords: [-75.6624, 41.4090], visited: true }
];

const metroStats = [
    { rank: 1, name: "New York–Newark–Jersey City", state: "NY-NJ", population: "19,500,000", shortName: "New York City" },
    { rank: 2, name: "Los Angeles–Long Beach–Anaheim", state: "CA", population: "12,799,100", shortName: "Los Angeles" },
    { rank: 3, name: "Chicago–Naperville–Elgin", state: "IL-IN", population: "9,262,825", shortName: "Chicago" },
    { rank: 4, name: "Dallas–Fort Worth–Arlington", state: "TX", population: "8,100,000", shortName: "Dallas" },
    { rank: 5, name: "Houston–Pasadena–The Woodlands", state: "TX", population: "7,500,000", shortName: "Houston" },
    { rank: 6, name: "Atlanta–Sandy Springs–Roswell", state: "GA", population: "6,307,261", shortName: "Atlanta" },
    { rank: 7, name: "Washington–Arlington–Alexandria", state: "DC-VA-MD-WV", population: "6,304,975", shortName: "Washington DC" },
    { rank: 8, name: "Philadelphia–Camden–Wilmington", state: "PA-NJ-DE-MD", population: "6,246,160", shortName: "Philadelphia" },
    { rank: 9, name: "Miami–Fort Lauderdale–West Palm Beach", state: "FL", population: "6,183,199", shortName: "Miami" },
    { rank: 10, name: "Phoenix–Mesa–Chandler", state: "AZ", population: "5,070,110", shortName: "Phoenix" },
    { rank: 11, name: "Boston–Cambridge–Newton", state: "MA-NH", population: "4,919,179", shortName: "Boston" },
    { rank: 12, name: "Riverside–San Bernardino–Ontario", state: "CA", population: "4,688,053", shortName: "Riverside" },
    { rank: 13, name: "San Francisco–Oakland–Fremont", state: "CA", population: "4,566,961", shortName: "San Francisco" },
    { rank: 14, name: "Detroit–Warren–Dearborn", state: "MI", population: "4,340,000", shortName: "Detroit" },
    { rank: 15, name: "Seattle–Tacoma–Bellevue", state: "WA", population: "4,044,837", shortName: "Seattle" },
    { rank: 16, name: "Minneapolis–St. Paul–Bloomington", state: "MN-WI", population: "3,710,000", shortName: "Minneapolis" },
    { rank: 17, name: "Tampa–St. Petersburg–Clearwater", state: "FL", population: "3,342,963", shortName: "Tampa" },
    { rank: 18, name: "San Diego–Chula Vista–Carlsbad", state: "CA", population: "3,269,973", shortName: "San Diego" },
    { rank: 19, name: "Denver–Aurora–Centennial", state: "CO", population: "3,005,131", shortName: "Denver" },
    { rank: 20, name: "Baltimore–Columbia–Towson", state: "MD", population: "2,834,316", shortName: "Baltimore" },
    { rank: 21, name: "Orlando–Kissimmee–Sanford", state: "FL", population: "2,817,933", shortName: "Orlando" },
    { rank: 22, name: "Charlotte–Concord–Gastonia", state: "NC-SC", population: "2,805,115", shortName: "Charlotte" },
    { rank: 23, name: "St. Louis", state: "MO-IL", population: "2,796,999", shortName: "St. Louis" },
    { rank: 24, name: "San Antonio–New Braunfels", state: "TX", population: "2,703,999", shortName: "San Antonio" },
    { rank: 25, name: "Portland–Vancouver–Hillsboro", state: "OR-WA", population: "2,508,050", shortName: "Portland" },
    { rank: 26, name: "Austin–Round Rock–San Marcos", state: "TX", population: "2,473,275", shortName: "Austin" },
    { rank: 27, name: "Pittsburgh", state: "PA", population: "2,422,725", shortName: "Pittsburgh" },
    { rank: 28, name: "Sacramento–Roseville–Folsom", state: "CA", population: "2,420,608", shortName: "Sacramento" },
    { rank: 29, name: "Las Vegas–Henderson–North Las Vegas", state: "NV", population: "2,336,573", shortName: "Las Vegas" },
    { rank: 30, name: "Cincinnati", state: "OH-KY-IN", population: "2,271,479", shortName: "Cincinnati" },
    { rank: 31, name: "Kansas City", state: "MO-KS", population: "2,220,000", shortName: "Kansas City" },
    { rank: 32, name: "Columbus", state: "OH", population: "2,180,271", shortName: "Columbus" },
    { rank: 33, name: "Cleveland", state: "OH", population: "2,158,932", shortName: "Cleveland" },
    { rank: 34, name: "Indianapolis–Carmel–Greenwood", state: "IN", population: "2,138,468", shortName: "Indianapolis" },
    { rank: 35, name: "Nashville-Davidson–Murfreesboro–Franklin", state: "TN", population: "2,102,573", shortName: "Nashville" },
    { rank: 36, name: "San Jose–Sunnyvale–Santa Clara", state: "CA", population: "1,945,000", shortName: "San Jose" },
    { rank: 37, name: "Virginia Beach–Chesapeake–Norfolk", state: "VA-NC", population: "1,787,169", shortName: "Virginia Beach" },
    { rank: 38, name: "Jacksonville", state: "FL", population: "1,713,240", shortName: "Jacksonville" },
    { rank: 39, name: "Providence–Warwick", state: "RI-MA", population: "1,677,803", shortName: "Providence" },
    { rank: 40, name: "Milwaukee–Waukesha", state: "WI", population: "1,560,424", shortName: "Milwaukee" },
    { rank: 41, name: "Raleigh–Cary", state: "NC", population: "1,509,231", shortName: "Raleigh" },
    { rank: 42, name: "Oklahoma City", state: "OK", population: "1,477,926", shortName: "Oklahoma City" },
    { rank: 43, name: "Louisville/Jefferson County", state: "KY-IN", population: "1,365,557", shortName: "Louisville" },
    { rank: 44, name: "Richmond", state: "VA", population: "1,349,732", shortName: "Richmond" },
    { rank: 45, name: "Memphis", state: "TN-MS-AR", population: "1,335,674", shortName: "Memphis" },
    { rank: 46, name: "Salt Lake City–Murray", state: "UT", population: "1,267,864", shortName: "Salt Lake City" },
    { rank: 47, name: "Birmingham", state: "AL", population: "1,184,290", shortName: "Birmingham" },
    { rank: 48, name: "Fresno", state: "CA", population: "1,180,020", shortName: "Fresno" },
    { rank: 49, name: "Grand Rapids–Wyoming–Kentwood", state: "MI", population: "1,162,950", shortName: "Grand Rapids" },
    { rank: 50, name: "Buffalo–Cheektowaga", state: "NY", population: "1,155,604", shortName: "Buffalo" },
    { rank: 51, name: "Hartford–West Hartford–East Hartford", state: "CT", population: "1,151,543", shortName: "Hartford" },
    { rank: 52, name: "Tucson", state: "AZ", population: "1,063,162", shortName: "Tucson" },
    { rank: 53, name: "Rochester", state: "NY", population: "1,052,087", shortName: "Rochester" },
    { rank: 54, name: "Tulsa", state: "OK", population: "1,044,757", shortName: "Tulsa" },
    { rank: 55, name: "Urban Honolulu", state: "HI", population: "989,408", shortName: "Honolulu" },
    { rank: 56, name: "Omaha", state: "NE-IA", population: "983,969", shortName: "Omaha" },
    { rank: 57, name: "Greenville–Anderson–Greer", state: "SC", population: "975,480", shortName: "Greenville" },
    { rank: 58, name: "New Orleans–Metairie", state: "LA", population: "962,165", shortName: "New Orleans" },
    { rank: 59, name: "Bridgeport–Stamford–Danbury", state: "CT", population: "951,558", shortName: "Bridgeport" },
    { rank: 60, name: "Knoxville", state: "TN", population: "946,264", shortName: "Knoxville" },
    { rank: 61, name: "Albuquerque", state: "NM", population: "922,296", shortName: "Albuquerque" },
    { rank: 62, name: "Bakersfield–Delano", state: "CA", population: "914,000", shortName: "Bakersfield" },
    { rank: 63, name: "North Port–Bradenton–Sarasota", state: "FL", population: "910,000", shortName: "Sarasota" },
    { rank: 64, name: "Albany–Schenectady–Troy", state: "NY", population: "904,682", shortName: "Albany" },
    { rank: 65, name: "McAllen–Edinburg–Mission", state: "TX", population: "898,000", shortName: "McAllen" },
    { rank: 66, name: "Baton Rouge", state: "LA", population: "873,000", shortName: "Baton Rouge" },
    { rank: 67, name: "Allentown–Bethlehem–Easton", state: "PA-NJ", population: "873,555", shortName: "Allentown" },
    { rank: 68, name: "El Paso", state: "TX", population: "873,331", shortName: "El Paso" },
    { rank: 69, name: "Worcester", state: "MA", population: "866,866", shortName: "Worcester" },
    { rank: 70, name: "Columbia", state: "SC", population: "858,000", shortName: "Columbia" },
    { rank: 71, name: "Charleston–North Charleston", state: "SC", population: "850,000", shortName: "Charleston" },
    { rank: 72, name: "Cape Coral–Fort Myers", state: "FL", population: "834,573", shortName: "Cape Coral" },
    { rank: 73, name: "Oxnard–Thousand Oaks–Ventura", state: "CA", population: "829,590", shortName: "Oxnard" },
    { rank: 74, name: "Boise City", state: "ID", population: "824,657", shortName: "Boise" },
    { rank: 75, name: "Lakeland–Winter Haven", state: "FL", population: "818,330", shortName: "Lakeland" },
    { rank: 76, name: "Dayton–Kettering–Beavercreek", state: "OH", population: "814,363", shortName: "Dayton" },
    { rank: 77, name: "Stockton–Lodi", state: "CA", population: "800,000", shortName: "Stockton" },
    { rank: 78, name: "Greensboro–High Point", state: "NC", population: "789,842", shortName: "Greensboro" },
    { rank: 79, name: "Colorado Springs", state: "CO", population: "768,832", shortName: "Colorado Springs" },
    { rank: 80, name: "Little Rock–North Little Rock–Conway", state: "AR", population: "764,000", shortName: "Little Rock" },
    { rank: 81, name: "Des Moines–West Des Moines", state: "IA", population: "737,164", shortName: "Des Moines" },
    { rank: 82, name: "Provo–Orem–Lehi", state: "UT", population: "732,000", shortName: "Provo" },
    { rank: 83, name: "Deltona–Daytona Beach–Ormond Beach", state: "FL", population: "721,000", shortName: "Deltona" },
    { rank: 84, name: "Kiryas Joel–Poughkeepsie–Newburgh", state: "NY", population: "704,620", shortName: "Poughkeepsie" },
    { rank: 85, name: "Akron", state: "OH", population: "698,398", shortName: "Akron" },
    { rank: 86, name: "Winston-Salem", state: "NC", population: "695,630", shortName: "Winston-Salem" },
    { rank: 87, name: "Madison", state: "WI", population: "694,345", shortName: "Madison" },
    { rank: 88, name: "Ogden", state: "UT", population: "658,133", shortName: "Ogden" },
    { rank: 89, name: "Syracuse", state: "NY", population: "652,956", shortName: "Syracuse" },
    { rank: 90, name: "Wichita", state: "KS", population: "652,939", shortName: "Wichita" },
    { rank: 91, name: "Palm Bay–Melbourne–Titusville", state: "FL", population: "643,979", shortName: "Palm Bay" },
    { rank: 92, name: "Augusta-Richmond County", state: "GA-SC", population: "629,429", shortName: "Augusta" },
    { rank: 93, name: "Jackson", state: "MS", population: "610,257", shortName: "Jackson" },
    { rank: 94, name: "Durham–Chapel Hill", state: "NC", population: "608,879", shortName: "Durham" },
    { rank: 95, name: "Harrisburg–Carlisle", state: "PA", population: "606,055", shortName: "Harrisburg" },
    { rank: 96, name: "Spokane–Spokane Valley", state: "WA", population: "600,292", shortName: "Spokane" },
    { rank: 97, name: "Toledo", state: "OH", population: "600,000", shortName: "Toledo" },
    { rank: 98, name: "Fayetteville–Springdale–Rogers", state: "AR", population: "590,337", shortName: "Fayetteville" },
    { rank: 99, name: "Chattanooga", state: "TN-GA", population: "580,000", shortName: "Chattanooga" },
    { rank: 100, name: "Scranton–Wilkes-Barre", state: "PA", population: "569,413", shortName: "Scranton" }
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
    { state: "NJ", name: "High Point", elevation: 1803, visited: true, coords: [-74.6615, 41.3208] },
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

const nationalParks = [
    { name: "Acadia", state: "ME", coords: [-68.2733, 44.3386], visited: true },
    { name: "Arches", state: "UT", coords: [-109.5863, 38.7331], visited: true },
    { name: "Badlands", state: "SD", coords: [-102.3397, 43.8554], visited: true },
    { name: "Big Bend", state: "TX", coords: [-103.2420, 29.2498], visited: true },
    { name: "Biscayne", state: "FL", coords: [-80.2100, 25.4824], visited: false },
    { name: "Black Canyon of the Gunnison", state: "CO", coords: [-107.7242, 38.5754], visited: false },
    { name: "Bryce Canyon", state: "UT", coords: [-112.1871, 37.5930], visited: false },
    { name: "Canyonlands", state: "UT", coords: [-109.8783, 38.2000], visited: true },
    { name: "Capitol Reef", state: "UT", coords: [-111.2615, 38.0877], visited: false },
    { name: "Carlsbad Caverns", state: "NM", coords: [-104.5571, 32.1478], visited: false },
    { name: "Channel Islands", state: "CA", coords: [-119.7214, 34.0069], visited: false },
    { name: "Congaree", state: "SC", coords: [-80.7821, 33.7948], visited: true },
    { name: "Crater Lake", state: "OR", coords: [-122.1685, 42.9446], visited: false },
    { name: "Cuyahoga Valley", state: "OH", coords: [-81.5712, 41.2808], visited: true },
    { name: "Death Valley", state: "CA", coords: [-116.8162, 36.5054], visited: false },
    { name: "Denali", state: "AK", coords: [-151.1926, 63.3333], visited: false },
    { name: "Dry Tortugas", state: "FL", coords: [-82.8732, 24.6285], visited: false },
    { name: "Everglades", state: "FL", coords: [-80.9000, 25.2866], visited: false },
    { name: "Gates of the Arctic", state: "AK", coords: [-153.3045, 67.7805], visited: false },
    { name: "Gateway Arch", state: "MO", coords: [-90.1847, 38.6247], visited: false },
    { name: "Glacier", state: "MT", coords: [-113.7870, 48.7596], visited: false },
    { name: "Glacier Bay", state: "AK", coords: [-136.8407, 58.6658], visited: false },
    { name: "Grand Canyon", state: "AZ", coords: [-112.1401, 36.0544], visited: false },
    { name: "Grand Teton", state: "WY", coords: [-110.6818, 43.7904], visited: true },
    { name: "Great Basin", state: "NV", coords: [-114.2631, 38.9831], visited: false },
    { name: "Great Sand Dunes", state: "CO", coords: [-105.5943, 37.7916], visited: true },
    { name: "Great Smoky Mountains", state: "TN", coords: [-83.5369, 35.6131], visited: true },
    { name: "Guadalupe Mountains", state: "TX", coords: [-104.8614, 31.9231], visited: true },
    { name: "Haleakalā", state: "HI", coords: [-156.1711, 20.7204], visited: false },
    { name: "Hawaii Volcanoes", state: "HI", coords: [-155.2864, 19.4194], visited: false },
    { name: "Hot Springs", state: "AR", coords: [-93.0552, 34.5217], visited: false },
    { name: "Indiana Dunes", state: "IN", coords: [-87.0972, 41.6533], visited: true },
    { name: "Isle Royale", state: "MI", coords: [-88.5558, 48.0000], visited: false },
    { name: "Joshua Tree", state: "CA", coords: [-115.9010, 33.8734], visited: true },
    { name: "Katmai", state: "AK", coords: [-155.0122, 58.6126], visited: false },
    { name: "Kenai Fjords", state: "AK", coords: [-149.6513, 59.9226], visited: false },
    { name: "Kings Canyon", state: "CA", coords: [-118.5551, 36.8879], visited: false },
    { name: "Kobuk Valley", state: "AK", coords: [-159.2837, 67.3556], visited: false },
    { name: "Lake Clark", state: "AK", coords: [-153.4177, 60.9672], visited: false },
    { name: "Lassen Volcanic", state: "CA", coords: [-121.4076, 40.4977], visited: false },
    { name: "Mammoth Cave", state: "KY", coords: [-86.1000, 37.1862], visited: true },
    { name: "Mesa Verde", state: "CO", coords: [-108.4618, 37.2309], visited: true },
    { name: "Mount Rainier", state: "WA", coords: [-121.7269, 46.8800], visited: true },
    { name: "New River Gorge", state: "WV", coords: [-81.0543, 38.0658], visited: true },
    { name: "North Cascades", state: "WA", coords: [-121.2069, 48.7718], visited: true },
    { name: "Olympic", state: "WA", coords: [-123.4979, 47.8021], visited: true },
    { name: "Petrified Forest", state: "AZ", coords: [-109.7920, 35.0657], visited: true },
    { name: "Pinnacles", state: "CA", coords: [-121.1825, 36.4906], visited: false },
    { name: "Redwood", state: "CA", coords: [-124.0046, 41.2132], visited: true },
    { name: "Rocky Mountain", state: "CO", coords: [-105.6836, 40.3428], visited: true },
    { name: "Saguaro", state: "AZ", coords: [-110.5885, 32.2967], visited: true },
    { name: "Sequoia", state: "CA", coords: [-118.5657, 36.4864], visited: false },
    { name: "Shenandoah", state: "VA", coords: [-78.4679, 38.4755], visited: true },
    { name: "Theodore Roosevelt", state: "ND", coords: [-103.4300, 46.9790], visited: false },
    { name: "Voyageurs", state: "MN", coords: [-92.8383, 48.4839], visited: false },
    { name: "White Sands", state: "NM", coords: [-106.3257, 32.7872], visited: true },
    { name: "Wind Cave", state: "SD", coords: [-103.4213, 43.5724], visited: false },
    { name: "Wrangell-St. Elias", state: "AK", coords: [-142.9857, 61.7104], visited: false },
    { name: "Yellowstone", state: "WY", coords: [-110.5885, 44.4280], visited: true },
    { name: "Yosemite", state: "CA", coords: [-119.5383, 37.8651], visited: false },
    { name: "Zion", state: "UT", coords: [-113.0263, 37.2982], visited: false },
    { name: "American Samoa", state: "AS", coords: [-90, 27], visited: false },
    { name: "Virgin Islands", state: "VI", coords: [-88, 26.9], visited: false },
];

const visitedStates = {
    "Alabama": true, "Alaska": false, "Arizona": true, "Arkansas": true, "California": true,
    "Colorado": true, "Connecticut": true, "Delaware": true, "Florida": true, "Georgia": true,
    "Hawaii": false, "Idaho": true, "Illinois": true, "Indiana": true, "Iowa": false,
    "Kansas": false, "Kentucky": true, "Louisiana": true, "Maine": true, "Maryland": true,
    "Massachusetts": true, "Michigan": true, "Minnesota": false, "Mississippi": true, "Missouri": false,
    "Montana": true, "Nebraska": true, "Nevada": true, "New Hampshire": true, "New Jersey": true,
    "New Mexico": true, "New York": true, "North Carolina": true, "North Dakota": true, "Ohio": true,
    "Oklahoma": true, "Oregon": true, "Pennsylvania": true, "Rhode Island": false, "South Carolina": true,
    "South Dakota": true, "Tennessee": true, "Texas": true, "Utah": true, "Vermont": true,
    "Virginia": true, "Washington": true, "West Virginia": true, "Wisconsin": false, "Wyoming": true
};

const additionalMetros = [
    { name: "New Haven", state: "CT", coords: [-72.9279, 41.3083], visited: false },
    { name: "Portland", state: "ME", coords: [-70.2548, 43.6591], visited: true },
    { name: "Reno", state: "NV", coords: [-119.8138, 39.5296], visited: false },
    { name: "Lancaster", state: "PA", coords: [-76.3055, 40.0379], visited: true },
    { name: "Modesto", state: "CA", coords: [-121.0000, 37.6390], visited: false },
    { name: "Port St. Lucie", state: "FL", coords: [-80.3534, 27.2939], visited: false },
    { name: "Pensacola", state: "FL", coords: [-87.2169, 30.4213], visited: false },
    { name: "Huntsville", state: "AL", coords: [-86.5861, 34.7304], visited: false },
    { name: "Lexington", state: "KY", coords: [-84.5037, 38.0406], visited: false },
    { name: "Killeen", state: "TX", coords: [-97.7277, 31.1171], visited: false },
    { name: "Springfield", state: "MO", coords: [-93.2986, 37.2090], visited: false },
    { name: "Santa Rosa", state: "CA", coords: [-122.7141, 38.4404], visited: false },
    { name: "Visalia", state: "CA", coords: [-119.2921, 36.3330], visited: false },
    { name: "Lansing", state: "MI", coords: [-84.5555, 42.7325], visited: false },
    { name: "Wilmington", state: "NC", coords: [-77.9447, 34.2104], visited: false },
    { name: "York", state: "PA", coords: [-76.7275, 39.9626], visited: false },
    { name: "Springfield", state: "MA", coords: [-72.5890, 42.1015], visited: false },
    { name: "Fort Wayne", state: "IN", coords: [-85.1289, 41.0793], visited: false },
    { name: "Waterbury", state: "CT", coords: [-73.0515, 41.5582], visited: false },
    { name: "Vallejo", state: "CA", coords: [-122.2566, 38.1041], visited: false },
    { name: "Corpus Christi", state: "TX", coords: [-97.3964, 27.8006], visited: true },
    { name: "Santa Maria", state: "CA", coords: [-120.4357, 34.9530], visited: false },
    { name: "Salem", state: "OR", coords: [-123.0351, 44.9429], visited: false },
    { name: "Reading", state: "PA", coords: [-75.9269, 40.3356], visited: false },
    { name: "Salinas", state: "CA", coords: [-121.6555, 36.6777], visited: false },
    { name: "Manchester", state: "NH", coords: [-71.4548, 42.9956], visited: false },
    { name: "Brownsville", state: "TX", coords: [-97.4975, 25.9017], visited: false },
    { name: "Youngstown", state: "OH", coords: [-80.6495, 41.0998], visited: false },
    { name: "Savannah", state: "GA", coords: [-81.0999, 32.0809], visited: false },
    { name: "Gulfport", state: "MS", coords: [-89.0928, 30.3674], visited: false },
    { name: "Asheville", state: "NC", coords: [-82.5515, 35.5951], visited: true },
    { name: "Lafayette", state: "LA", coords: [-92.0199, 30.2241], visited: false },
    { name: "Mobile", state: "AL", coords: [-88.0399, 30.6954], visited: false },
    { name: "Ocala", state: "FL", coords: [-82.1400, 29.1872], visited: false },
    { name: "Naples", state: "FL", coords: [-81.7948, 26.1420], visited: false },
    { name: "Flint", state: "MI", coords: [-83.6874, 43.0126], visited: false },
    { name: "Anchorage", state: "AK", coords: [-149.9003, 61.2181], visited: false },
    { name: "Canton", state: "OH", coords: [-81.3784, 40.7989], visited: false },
    { name: "Myrtle Beach", state: "SC", coords: [-78.8867, 33.6891], visited: true },
    { name: "Beaumont", state: "TX", coords: [-94.1018, 30.0802], visited: true },
    { name: "Tallahassee", state: "FL", coords: [-84.2807, 30.4383], visited: false },
    { name: "Fayetteville", state: "NC", coords: [-78.8787, 35.0527], visited: false },
    { name: "Montgomery", state: "AL", coords: [-86.2996, 32.3792], visited: false },
    { name: "Spartanburg", state: "SC", coords: [-81.9321, 34.9495], visited: false },
    { name: "Shreveport", state: "LA", coords: [-93.7505, 32.5252], visited: false },
    { name: "Trenton", state: "NJ", coords: [-74.7429, 40.2206], visited: false },
    { name: "Eugene", state: "OR", coords: [-123.0868, 44.0521], visited: false },
    { name: "Davenport", state: "IA", coords: [-90.5777, 41.5236], visited: false },
    { name: "Fort Collins", state: "CO", coords: [-105.0844, 40.5853], visited: false },
    { name: "Hickory", state: "NC", coords: [-81.3412, 35.7332], visited: false },
    { name: "Atlantic City", state: "NJ", coords: [-74.4232, 39.3643], visited: false },
    { name: "Huntington", state: "WV", coords: [-82.4452, 38.4192], visited: false },
    { name: "Ann Arbor", state: "MI", coords: [-83.7430, 42.2808], visited: true },
    { name: "Peoria", state: "IL", coords: [-89.5890, 40.6936], visited: false },
    { name: "Lubbock", state: "TX", coords: [-101.8552, 33.5779], visited: false },
    { name: "Greeley", state: "CO", coords: [-104.7091, 40.4233], visited: false },
    { name: "Gainesville", state: "FL", coords: [-82.3248, 29.6516], visited: false },
    { name: "Lincoln", state: "NE", coords: [-96.6782, 40.8136], visited: false },
    { name: "Clarksville", state: "TN", coords: [-87.3594, 36.5298], visited: false },
    { name: "Rockford", state: "IL", coords: [-89.0940, 42.2711], visited: false },
    { name: "Green Bay", state: "WI", coords: [-88.0133, 44.5133], visited: false },
    { name: "Boulder", state: "CO", coords: [-105.2705, 40.0150], visited: true },
    { name: "South Bend", state: "IN", coords: [-86.2520, 41.6764], visited: true },
    { name: "Columbus", state: "GA", coords: [-84.9877, 32.4610], visited: false },
    { name: "Roanoke", state: "VA", coords: [-79.9414, 37.2710], visited: true },
    { name: "Kennewick", state: "WA", coords: [-119.1307, 46.2087], visited: true },
    { name: "Kingsport", state: "TN", coords: [-82.5618, 36.5484], visited: true },
    { name: "Hagerstown", state: "MD", coords: [-77.7199, 39.6418], visited: true },
    { name: "Waco", state: "TX", coords: [-97.1467, 31.5493], visited: false },
    { name: "Fort Walton Beach", state: "FL", coords: [-86.6187, 30.4058], visited: false },
    { name: "Sioux Falls", state: "SD", coords: [-96.7311, 43.5446], visited: false },
    { name: "Olympia", state: "WA", coords: [-122.9007, 47.0379], visited: true },
    { name: "Longview", state: "TX", coords: [-94.7405, 32.5007], visited: false },
    { name: "Merced", state: "CA", coords: [-120.4829, 37.3022], visited: false },
    { name: "Utica", state: "NY", coords: [-75.2327, 43.1009], visited: false },
    { name: "San Luis Obispo", state: "CA", coords: [-120.6596, 35.2828], visited: false },
    { name: "Duluth", state: "MN", coords: [-92.1005, 46.7867], visited: false },
    { name: "College Station", state: "TX", coords: [-96.3344, 30.6280], visited: false },
    { name: "Norwich", state: "CT", coords: [-72.0759, 41.5243], visited: false },
    { name: "Tuscaloosa", state: "AL", coords: [-87.5692, 33.2098], visited: true },
    { name: "Bremerton", state: "WA", coords: [-122.6329, 47.5673], visited: false },
    { name: "Cedar Rapids", state: "IA", coords: [-91.6656, 41.9779], visited: false },
    { name: "Slidell", state: "LA", coords: [-89.7812, 30.2752], visited: false },
    { name: "Amarillo", state: "TX", coords: [-101.8313, 35.2220], visited: true },
    { name: "Evansville", state: "IN", coords: [-87.5711, 37.9716], visited: false },
    { name: "Laredo", state: "TX", coords: [-99.5076, 27.5064], visited: false },
    { name: "Erie", state: "PA", coords: [-80.0852, 42.1292], visited: false },
    { name: "Lynchburg", state: "VA", coords: [-79.1417, 37.4138], visited: true },
    { name: "Fargo", state: "ND", coords: [-96.7898, 46.8772], visited: false },
    { name: "Kalamazoo", state: "MI", coords: [-85.5872, 42.2917], visited: false },
    { name: "Santa Cruz", state: "CA", coords: [-122.0308, 36.9741], visited: false },
    { name: "Bend", state: "OR", coords: [-121.3153, 44.0582], visited: true },
    { name: "Yakima", state: "WA", coords: [-120.5059, 46.6021], visited: true },
    { name: "Daphne", state: "AL", coords: [-87.9036, 30.6035], visited: false },
    { name: "Prescott", state: "AZ", coords: [-112.4685, 34.5400], visited: false },
    { name: "Appleton", state: "WI", coords: [-88.4154, 44.2619], visited: false },
    { name: "Tyler", state: "TX", coords: [-95.3011, 32.3513], visited: false },
    { name: "Binghamton", state: "NY", coords: [-75.9180, 42.0987], visited: false },
    { name: "Lake Charles", state: "LA", coords: [-93.2174, 30.2266], visited: false },
    { name: "Macon", state: "GA", coords: [-83.6324, 32.8407], visited: false }
];
