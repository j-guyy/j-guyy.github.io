// US map view of us-dashboard.html. js/dashboard.js owns the data (metros,
// highPoints, nationalParks, visitedStates) and calls USMap.render() the first
// time the Map view is opened, and again after an edit changes the data.
// d3 + topojson are loaded on demand so the Tables view never downloads them.

const USMap = (() => {
    const SCRIPTS = [
        'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js'
    ];
    let libs = null;
    let controlsReady = false;

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.onload = resolve;
            el.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(el);
        });
    }

    function loadLibs() {
        // In order: topojson doesn't need d3, but keep it simple and predictable.
        if (!libs) {
            libs = SCRIPTS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
                .catch(err => { libs = null; throw err; });
        }
        return libs;
    }

    async function render() {
        const mapEl = document.getElementById('combined-map');
        try {
            await loadLibs();
        } catch (err) {
            console.error(err);
            mapEl.textContent = 'Error loading map. Please try again later.';
            return;
        }
        mapEl.innerHTML = '';
        document.getElementById('map-legend').innerHTML = '';
        await createCombinedMap();
        if (!controlsReady) {
            setupToggleButtons();
            controlsReady = true;
        }
        applyCategoryVisibility();
    }

    return { render };
})();

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
    return d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
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

// Which marker categories are shown; survives a re-render after an edit.
const MAP_CATEGORIES = [
    { selector: '.city-dot.top-100', button: 'toggle-metros', label: 'Top 100 Metros', visible: true },
    { selector: '.city-dot.top-200', button: 'toggle-additional-metros', label: 'Additional Metros', visible: false },
    { selector: '.high-point-triangle', button: 'toggle-highpoints', label: 'High Points', visible: true },
    { selector: '.national-park-square', button: 'toggle-parks', label: 'National Parks', visible: true }
];

function setupToggleButtons() {
    MAP_CATEGORIES.forEach(cat => {
        document.getElementById(cat.button).addEventListener('click', () => {
            cat.visible = !cat.visible;
            applyCategoryVisibility();
        });
    });
}

function applyCategoryVisibility() {
    MAP_CATEGORIES.forEach(cat => {
        document.querySelectorAll(`#combined-map ${cat.selector}`).forEach(el => {
            el.style.display = cat.visible ? '' : 'none';
        });
        updateButtonState(document.getElementById(cat.button), cat.visible, cat.label);
    });
}

function updateButtonState(button, isVisible, categoryName) {
    button.classList.toggle('inactive', !isVisible);
    button.textContent = `${isVisible ? 'Hide' : 'Show'} ${categoryName}`;
}
