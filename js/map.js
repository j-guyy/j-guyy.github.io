let metros, highPoints, nationalParks, visitedStates;

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        fetch('/data/metros.json').then(response => response.json()),
        fetch('/data/highPoints.json').then(response => response.json()),
        fetch('/data/nationalParks.json').then(response => response.json()),
        fetch('/data/visitedStates.json').then(response => response.json())
    ])
        .then(([metrosData, highPointsData, nationalParksData, visitedStatesData]) => {
            metros = metrosData;
            highPoints = highPointsData;
            nationalParks = nationalParksData;
            visitedStates = visitedStatesData;
            displayTravelSummary();
            createCombinedMap();
            setupToggleButtons();
        })
        .catch(error => console.error('Error loading the JSON files:', error));
});

function displayTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    if (!summaryContainer) return;

    const stateCount = Object.values(visitedStates).filter(v => v).length;
    const statePercentage = ((stateCount / 50) * 100).toFixed(0);
    const top100Metros = metros.filter(c => c.rank <= 100);
    const metroCount = top100Metros.filter(c => c.visited).length;
    const metroPercentage = ((metroCount / 100) * 100).toFixed(0);
    const highPointCount = highPoints.filter(p => p.visited).length;
    const highPointPercentage = ((highPointCount / 50) * 100).toFixed(0);
    const parkCount = nationalParks.filter(p => p.visited).length;
    const parkPercentage = ((parkCount / nationalParks.length) * 100).toFixed(0);

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
                        <span class="stat-total">/100</span>
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
}

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

            // Add metros (circles) - filter out metros with invalid coordinates
            const validMetros = metros.filter(d => d.coords && Array.isArray(d.coords) && d.coords.length === 2 && !isNaN(d.coords[0]) && !isNaN(d.coords[1]));
            svg.selectAll(".city-dot")
                .data(validMetros)
                .enter().append("circle")
                .attr("class", d => `city-dot ${d.visited ? 'visited' : 'not-visited'} ${d.rank <= 100 ? 'top-100' : 'top-200'}`)
                .attr("cx", d => {
                    const projected = projection(d.coords);
                    return projected ? projected[0] : 0;
                })
                .attr("cy", d => {
                    const projected = projection(d.coords);
                    return projected ? projected[1] : 0;
                })
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

            // Add high points (triangles) - filter out points with invalid coordinates
            const validHighPoints = highPoints.filter(d => d.coords && Array.isArray(d.coords) && d.coords.length === 2 && !isNaN(d.coords[0]) && !isNaN(d.coords[1]));
            svg.selectAll(".high-point-triangle")
                .data(validHighPoints)
                .enter().append("path")
                .attr("class", d => `high-point-triangle ${d.visited ? 'visited' : 'not-visited'}`)
                .attr("d", d3.symbol().type(d3.symbolTriangle).size(100))
                .attr("transform", d => {
                    const projected = projection(d.coords);
                    return projected ? `translate(${projected[0]}, ${projected[1]})` : 'translate(0, 0)';
                })
                .on("mouseover", function (event, d) {
                    handleMouseOver(this, event, d, tooltip, 'highpoint');
                })
                .on("mouseout", function () {
                    handleMouseOut(this, tooltip, 'highpoint');
                })
                .on("click", function (event, d) {
                    handleClick(d, 'highpoint');
                });

            // Add national parks (squares) - filter out parks with invalid coordinates
            const validNationalParks = nationalParks.filter(d => d.coords && Array.isArray(d.coords) && d.coords.length === 2 && !isNaN(d.coords[0]) && !isNaN(d.coords[1]));
            svg.selectAll(".national-park-square")
                .data(validNationalParks)
                .enter().append("rect")
                .attr("class", d => `national-park-square ${d.visited ? 'visited' : 'not-visited'}`)
                .attr("x", d => {
                    const projected = projection(d.coords);
                    return projected ? projected[0] - 5 : -5;
                })
                .attr("y", d => {
                    const projected = projection(d.coords);
                    return projected ? projected[1] - 5 : -5;
                })
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
    // Handle element scaling/size changes (unchanged)
    if (type === 'highpoint') {
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

    // Show tooltip
    tooltip.transition()
        .duration(200)
        .style("opacity", .9);

    let tooltipContent = type === 'metro'
        ? `<strong>${d.name}, ${d.state}</strong><br/>${d.visited ? 'Visited' : 'Not Visited'}`
        : type === 'highpoint'
            ? `<strong>${d.name}, ${d.state}</strong><br/>${d.elevation} ft<br/>${d.visited ? 'Summited' : 'Not Summited'}`
            : `<strong>${d.name} NP</strong><br/>${d.state}<br/>${d.visited ? 'Visited' : 'Not Visited'}`;

    tooltip.html(tooltipContent);

    // Get map container bounds
    const mapContainer = d3.select("#combined-map").node();
    const mapBounds = mapContainer.getBoundingClientRect();

    // Get mouse position relative to map container
    const mouseX = event.clientX - mapBounds.left;
    const mouseY = event.clientY - mapBounds.top;

    const tooltipWidth = tooltip.node().offsetWidth;
    const tooltipHeight = tooltip.node().offsetHeight;

    // Calculate position
    let left = mouseX + 15;
    let top = mouseY + 15;

    // Adjust if tooltip would go off the right side of the map
    if (left + tooltipWidth > mapBounds.width) {
        left = mouseX - tooltipWidth - 15;
    }

    // Adjust if tooltip would go off the bottom of the map
    if (top + tooltipHeight > mapBounds.height) {
        top = mouseY - tooltipHeight - 15;
    }

    // Set position relative to map container
    tooltip
        .style("left", left + "px")
        .style("top", top + "px");
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
    // Click functionality removed - no longer opens Wikipedia links
    // Items are still clickable but don't perform any action
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
