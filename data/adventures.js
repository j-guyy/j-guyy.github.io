// Adventure data for featured adventures page
const adventureData = {
    // Featured adventures - prominently displayed at top of page
    featured: [
        {
            id: 'pico-de-orizaba',
            title: 'Pico de Orizaba',
            subtitle: 'The tallest volcano in North America',
            image: 'images/mountaineering/pico/summit_cropped.jpg',
            description: 'Successfully summited the highest peak in Mexico at 18,491 feet, conquering glacier travel and extreme altitude in this challenging mountaineering expedition.',
            category: 'Mountaineering',
            date: '2024',
            link: 'trip-reports/pico-de-orizaba.html',
            completed: true
        },
        {
            id: 'creede-100',
            title: 'Creede 100',
            subtitle: 'There is no night in Creede',
            image: 'images/ultrarunning/creede/finish_cropped.jpg',
            description: 'Completed this grueling 100-mile ultramarathon through the Colorado Rockies, testing endurance limits across challenging mountain terrain.',
            category: 'Ultrarunning',
            date: '2023',
            link: 'trip-reports/creede-100.html',
            completed: true
        },
        {
            id: 'ironman-lake-placid',
            title: 'IRONMAN Lake Placid',
            subtitle: '140.6 miles in the Adirondack High Peaks',
            image: 'images/triathlon/imlp/bikevert_cropped.jpg',
            description: 'Conquered the full IRONMAN distance of 2.4-mile swim, 112-mile bike, and 26.2-mile run in the challenging terrain of the Adirondack Mountains.',
            category: 'Triathlon',
            date: '2019',
            link: 'trip-reports/ironman-lake-placid.html',
            completed: true
        }
    ],

    // All adventures organized by category
    categories: {
        mountaineering: [
            {
                id: 'pico-de-orizaba',
                title: 'Pico de Orizaba',
                image: 'images/mountaineering/pico/summit.jpg',
                category: 'Mountaineering',
                completed: true,
                date: '2024',
                link: 'trip-reports/pico-de-orizaba.html'
            },
            {
                id: 'rainier',
                title: 'Mount Rainier',
                image: 'images/mountaineering/rainier.jpg',
                category: 'Mountaineering',
                completed: true,
                date: '2024',
                link: 'trip-reports/mount-rainier.html'
            },
            {
                id: 'iztaccihuatl',
                title: 'Iztaccíhuatl',
                image: 'images/mountaineering/izta.jpg',
                category: 'Mountaineering',
                completed: true,
                date: '2024',
                link: 'trip-reports/iztaccihuatl.html'
            },
            {
                id: 'hood',
                title: 'Mount Hood',
                image: 'images/mountaineering/hood.jpg',
                category: 'Mountaineering',
                completed: true,
                date: '2022',
                link: 'trip-reports/mount-hood.html'
            },
            {
                id: 'adams',
                title: 'Mount Adams',
                image: 'images/mountaineering/adams.jpg',
                category: 'Mountaineering',
                completed: true,
                date: '2022',
                link: 'trip-reports/mount-adams.html'
            }
        ],

        hiking: [
            {
                id: 'colorado-14ers',
                title: 'Colorado 14ers',
                image: 'images/hiking/huron.jpg',
                category: 'Hiking',
                completed: false,
                link: 'trip-reports/colorado-14ers.html'
            },
            {
                id: 'adirondack-46ers',
                title: 'Adirondack 46ers',
                image: 'images/hiking/algonquin_group.jpg',
                category: 'Hiking',
                completed: false,
                link: 'trip-reports/adirondack-46ers.html'
            },
            {
                id: 'british-isles-high-five',
                title: 'British Isles High Five',
                image: 'images/hiking/carrauntoohil.jpg',
                category: 'Hiking',
                completed: false,
                link: 'trip-reports/british-isles-high-five.html'
            },
            {
                id: 'halla-san',
                title: 'Halla-san',
                image: 'images/hiking/hallasan.jpg',
                category: 'Hiking',
                completed: true,
                link: '#'
            },
            {
                id: 'fuji',
                title: 'Mount Fuji',
                image: 'images/hiking/fuji.jpg',
                category: 'Hiking',
                completed: true,
                link: '#'
            },
            {
                id: 'mulhacen',
                title: 'Mulhacén',
                image: 'images/hiking/mulhacen.jpg',
                category: 'Hiking',
                completed: true,
                link: '#'
            },
            {
                id: 'sincholagua',
                title: 'Sincholagua',
                image: 'images/hiking/sincholagua.jpg',
                category: 'Hiking',
                completed: true,
                link: '#'
            },
            {
                id: 'kosciuszko',
                title: 'Mount Kosciuszko',
                image: 'images/hiking/kosciuszko.jpg',
                category: 'Hiking',
                completed: true,
                link: '#'
            }
        ],

        cycling: [
            {
                id: 'mt-blue-sky',
                title: 'Mt Blue Sky',
                image: 'images/cycling/bluesky.jpg',
                category: 'Cycling',
                completed: true,
                link: '#'
            },
            {
                id: 'normandy',
                title: 'Normandy',
                image: 'images/cycling/normandy.jpg',
                category: 'Cycling',
                completed: true,
                link: '#'
            },
            {
                id: 'natchez-trace',
                title: 'Natchez Trace',
                image: 'images/cycling/natchez.jpg',
                category: 'Cycling',
                completed: true,
                link: '#'
            },
            {
                id: 'badlands',
                title: 'Badlands',
                image: 'images/cycling/badlands.jpg',
                category: 'Cycling',
                completed: true,
                link: '#'
            },
            {
                id: 'jeju',
                title: 'Jeju Island',
                image: 'images/cycling/jeju.jpg',
                category: 'Cycling',
                completed: true,
                link: '#'
            }
        ],

        skiing: [
            {
                id: 'backcountry',
                title: 'Backcountry',
                image: 'images/skiing/tom.jpg',
                category: 'Skiing',
                completed: true,
                link: '#'
            },
            {
                id: 'resort',
                title: 'Resort',
                image: 'images/skiing/snowbird.jpg',
                category: 'Skiing',
                completed: true,
                link: '#'
            },
            {
                id: 'nordic',
                title: 'Nordic',
                image: 'images/skiing/bigsky.jpg',
                category: 'Skiing',
                completed: true,
                link: '#'
            }
        ],

        ultrarunning: [
            {
                id: 'creede-100',
                title: 'Creede 100',
                image: 'images/ultrarunning/creede/finish_cropped.jpg',
                category: 'Ultrarunning',
                completed: true,
                date: '2023',
                link: 'trip-reports/creede-100.html'
            },
            {
                id: 'skydive-ultra',
                title: 'Skydive Ultra',
                image: 'images/ultrarunning/skydive.JPG',
                category: 'Ultrarunning',
                completed: true,
                link: '#'
            },
            {
                id: 'spartan-ultra-montana',
                title: 'Spartan Ultra Montana',
                image: 'images/ultrarunning/spartan.jpg',
                category: 'Ultrarunning',
                completed: true,
                link: '#'
            },
            {
                id: 'old-cascadia-50',
                title: 'Old Cascadia 50',
                image: 'images/ultrarunning/old_cascadia/sunrise.jpg',
                category: 'Ultrarunning',
                completed: true,
                link: '#'
            },
            {
                id: 'badger-mountain-55k',
                title: 'Badger Mountain 55k',
                image: 'images/ultrarunning/badger.jpg',
                category: 'Ultrarunning',
                completed: true,
                link: '#'
            }
        ],

        triathlon: [
            {
                id: 'ironman-lake-placid',
                title: 'IRONMAN Lake Placid',
                image: 'images/triathlon/imlp/bikevert_cropped.jpg',
                category: 'Triathlon',
                completed: true,
                date: '2019',
                link: 'trip-reports/ironman-lake-placid.html'
            },
            {
                id: 'eagleman-70-3',
                title: 'Eagleman 70.3',
                image: 'images/triathlon/eagleman/swim_cropped.jpg',
                category: 'Triathlon',
                completed: true,
                link: '#'
            },
            {
                id: 'ud-triathlon',
                title: 'University of Delaware Triathlon',
                image: 'images/triathlon/hague.jpg',
                category: 'Triathlon',
                completed: true,
                link: '#'
            }
        ]
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = adventureData;
}