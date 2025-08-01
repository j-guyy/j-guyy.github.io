// Side Quests JavaScript - handles completion cards and data loading

let colorado14ers, adirondack46ers, britishIslesHighFive;

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        fetch('/data/colorado14ers.json').then(response => response.json()),
        fetch('/data/adirondack46ers.json').then(response => response.json()),
        fetch('/data/british-isles-high-five.json').then(response => response.json())
    ])
        .then(([colorado14ersData, adirondack46ersData, britishIslesData]) => {
            colorado14ers = colorado14ersData;
            adirondack46ers = adirondack46ersData;
            britishIslesHighFive = britishIslesData;
            displayQuestSummary();
        })
        .catch(error => console.error('Error loading the JSON files:', error));
});

function displayQuestSummary() {
    const summaryContainer = document.getElementById('quest-summary');

    // Calculate completion statistics
    const colorado14ersCompleted = colorado14ers.filter(peak => peak.climbed).length;
    const colorado14ersTotal = colorado14ers.length;
    const colorado14ersPercentage = ((colorado14ersCompleted / colorado14ersTotal) * 100).toFixed(0);

    const adirondack46ersCompleted = adirondack46ers.filter(peak => peak.climbed).length;
    const adirondack46ersTotal = adirondack46ers.length;
    const adirondack46ersPercentage = ((adirondack46ersCompleted / adirondack46ersTotal) * 100).toFixed(0);

    const britishIslesCompleted = britishIslesHighFive.filter(peak => peak.climbed).length;
    const britishIslesTotal = britishIslesHighFive.length;
    const britishIslesPercentage = ((britishIslesCompleted / britishIslesTotal) * 100).toFixed(0);
    const isCompleted = britishIslesCompleted === britishIslesTotal;

    // Display completion cards using dashboard styling
    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="other-stats">
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${colorado14ersCompleted}</span>
                        <span class="stat-total">/${colorado14ersTotal}</span>
                        <span class="stat-percentage">(${colorado14ersPercentage}%)</span>
                    </div>
                    <span class="stat-label">Colorado 14ers</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${adirondack46ersCompleted}</span>
                        <span class="stat-total">/${adirondack46ersTotal}</span>
                        <span class="stat-percentage">(${adirondack46ersPercentage}%)</span>
                    </div>
                    <span class="stat-label">Adirondack 46ers</span>
                </div>
                <div class="summary-stat ${isCompleted ? 'completed-quest' : ''}">
                    <div class="stat-number-container">
                        <span class="stat-number">${britishIslesCompleted}</span>
                        <span class="stat-total">/${britishIslesTotal}</span>
                        <span class="stat-percentage">(${britishIslesPercentage}%)</span>
                        ${isCompleted ? '<span class="completion-check">✅</span>' : ''}
                    </div>
                    <span class="stat-label">British Isles High Five</span>
                </div>
            </div>
        </div>
    `;
}