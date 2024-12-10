document.addEventListener('DOMContentLoaded', function () {
    const width = 960;
    const height = 600;

    const svg = d3.select("#us-map")
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const projection = d3.geoAlbersUsa()
        .translate([width / 2, height / 2])
        .scale(1200);

    const path = d3.geoPath().projection(projection);

    // Load US map data
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
        .then(function (us) {
            svg.append("g")
                .selectAll("path")
                .data(topojson.feature(us, us.objects.states).features)
                .enter().append("path")
                .attr("class", "state")
                .attr("d", path);

            // Define your visited and not visited cities
            const cities = [
                { name: "New York", state: "NY", coords: [-74.006, 40.7128], visited: true },
                { name: "Los Angeles", state: "CA", coords: [-118.2437, 34.0522], visited: true },
                { name: "Chicago", state: "IL", coords: [-87.6298, 41.8781], visited: true },
                { name: "Houston", state: "TX", coords: [-95.3698, 29.7604], visited: false },
                { name: "Phoenix", state: "AZ", coords: [-112.0740, 33.4484], visited: false },
                // Add more cities as needed
            ];

            svg.selectAll(".city-dot")
                .data(cities)
                .enter().append("circle")
                .attr("class", d => `city-dot ${d.visited ? 'visited' : 'not-visited'}`)
                .attr("cx", d => projection(d.coords)[0])
                .attr("cy", d => projection(d.coords)[1])
                .attr("r", 5)
                .on("click", function (event, d) {
                    if (d.visited) {
                        window.open(`https://en.wikipedia.org/wiki/${d.name},_${d.state}`, '_blank');
                    }
                });
        })
        .catch(function (error) {
            console.error("Error loading or parsing data:", error);
            document.getElementById("us-map").innerHTML = "Error loading map. Please try again later.";
        });
});
