let metros;

document.addEventListener('DOMContentLoaded', function () {
    fetch('/data/city_metro_data.json')
        .then(response => response.json())
        .then(data => {
            metros = data;
            createCombinedMap();
            displayTravelSummary();
            setupToggleButtons();
        })
        .catch(error => console.error('Error loading the JSON file:', error));
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
            const allMetros = [...metros, ...additionalMetros];
            svg.selectAll(".city-dot")
                .data(allMetros)
                .enter().append("circle")
                .attr("class", d => `city-dot ${d.visited ? 'visited' : 'not-visited'} ${d.rank <= 100 ? 'top-100' : 'top-200'}`)
                .attr("cx", d => projection(d.coords)[0])
                .attr("cy", d => projection(d.coords)[1])
                .style("display", d => d.rank <= 100 ? null : 'none') // Hide additional metros by default
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
        ? `<strong>${d.name}, ${d.state}</strong><br/>${d.visited ? 'Visited' : 'Not Visited'}`
        : type === 'highpoint'
            ? `<strong>${d.name}, ${d.state}</strong><br/>${d.elevation} ft<br/>${d.visited ? 'Summited' : 'Not Summited'}`
            : `<strong>${d.name} NP</strong><br/>${d.state}<br/>${d.visited ? 'Visited' : 'Not Visited'}`;

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
    const metroCount = metros.filter(city => city.visited).length;
    const metroPercentage = ((metroCount / metros.length) * 100).toFixed(0);
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
                        <span class="stat-total">/${metros.length}</span>
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
        tableData = metros.sort((a, b) => a.rank - b.rank);
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
                <td>${item.metro_name}</td>
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
