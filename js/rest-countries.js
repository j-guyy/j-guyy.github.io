/**
 * Fetches population data from REST Countries API and merges it
 * into the local countries data (which stores name + visited + population fallback).
 * 
 * Designed to be non-blocking: pages render immediately with local data,
 * then population gets updated in the background when the API responds.
 */

const REST_COUNTRIES_URL = 'https://restcountries.com/v3.1/all?fields=name,population';

// Name mappings: local name -> REST Countries API common name
const NAME_MAPPINGS = {
    'United States of America': 'United States',
    'Czech Republic': 'Czechia',
    'DR Congo': 'DR Congo',
    'Ivory Coast': "Côte d'Ivoire",
    'Cape Verde': 'Cabo Verde',
    'Congo': 'Republic of the Congo',
    'Timor-Leste': 'Timor-Leste',
    'Micronesia': 'Micronesia',
    'North Korea': 'North Korea',
    'South Korea': 'South Korea',
    'Palestine': 'Palestine',
    'Taiwan': 'Taiwan',
    'Turkey': 'Turkey',
    'Eswatini': 'Eswatini',
    'Myanmar': 'Myanmar'
};

let _populationCache = null;

async function fetchPopulationData() {
    if (_populationCache) return _populationCache;

    try {
        const response = await fetch(REST_COUNTRIES_URL);
        const data = await response.json();

        const popMap = {};
        data.forEach(country => {
            const common = country.name.common.toLowerCase();
            popMap[common] = country.population;
            if (country.name.official) {
                popMap[country.name.official.toLowerCase()] = country.population;
            }
        });

        _populationCache = popMap;
        return popMap;
    } catch (error) {
        console.warn('REST Countries API unavailable, using local population data', error);
        return null;
    }
}

function lookupPopulation(countryName, popMap) {
    if (!popMap) return null;

    const lower = countryName.toLowerCase();
    if (popMap[lower] !== undefined) return popMap[lower];

    const mapped = NAME_MAPPINGS[countryName];
    if (mapped && popMap[mapped.toLowerCase()] !== undefined) {
        return popMap[mapped.toLowerCase()];
    }

    return null;
}

function mergePopulationData(countriesData, popMap) {
    if (!popMap) return countriesData;

    const continentKeys = [
        'northAmericanCountries', 'southAmericanCountries',
        'europeanCountries', 'asianCountries',
        'africanCountries', 'oceaniaCountries'
    ];

    continentKeys.forEach(key => {
        if (countriesData[key]) {
            countriesData[key].forEach(country => {
                const pop = lookupPopulation(country.name, popMap);
                if (pop !== null) {
                    country.population = pop;
                }
            });
        }
    });

    return countriesData;
}

/**
 * Loads countries.json immediately for fast rendering.
 * Kicks off the REST Countries API fetch in the background.
 * Calls onPopulationUpdate when live data arrives so the page can re-render.
 */
async function loadCountriesWithPopulation(jsonPath, onPopulationUpdate) {
    const countriesData = await fetch(jsonPath).then(r => r.json());

    // Fire off the API call in the background — don't block rendering
    fetchPopulationData().then(popMap => {
        if (popMap) {
            mergePopulationData(countriesData, popMap);
            if (onPopulationUpdate) {
                onPopulationUpdate(countriesData);
            }
        }
    });

    return countriesData;
}
