let metros, highPoints, nationalParks, visitedStates, additionalMetros;

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        fetch('/data/baseMetros.json').then(response => response.json()),
        fetch('/data/highPoints.json').then(response => response.json()),
        fetch('/data/nationalParks.json').then(response => response.json()),
        fetch('/data/visitedStates.json').then(response => response.json()),
        fetch('/data/addtionalMetros.json').then(response => response.json())
    ])
        .then(([metrosData, highPointsData, nationalParksData, visitedStatesData, additionalMetrosData]) => {
            metros = metrosData;
            highPoints = highPointsData;
            nationalParks = nationalParksData;
            visitedStates = visitedStatesData;
            additionalMetros = additionalMetrosData.metros;
            createCombinedMap();
            setupToggleButtons();
        })
        .catch(error => console.error('Error loading the JSON files:', error));
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
