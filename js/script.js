// We don't need the natureImages array anymore since we're using a fixed range

function getRandomNumber() {
    // Generate a random number between 4 and 34 (inclusive)
    return Math.floor(Math.random() * (34 - 4 + 1)) + 4;
}

function getImagePath(number) {
    // Generate the image path based on the number
    return `images/img${number}.jpg`;
}

function generateRandom() {
    // Generate random number
    const randomNum = getRandomNumber();
    document.getElementById('randomNumber').textContent = 'Random Number: ' + randomNum;

    // Set random background image
    const imagePath = getImagePath(randomNum);
    document.body.style.backgroundImage = `url(${imagePath})`;
}

// Set initial background image and random number when the page loads
document.addEventListener('DOMContentLoaded', function () {
    // Home page functionality
    const generateButton = document.getElementById('generateButton');
    const randomNumberDisplay = document.getElementById('randomNumber');
    const contentBox = document.querySelector('.content');
    const body = document.body;
    const imageCache = {};

    // Set initial background to black and hide content
    body.style.backgroundColor = 'black';
    body.style.transition = 'background-image 0.5s ease-in-out';
    contentBox.style.opacity = '0';
    contentBox.style.transform = 'scale(0.9)';

    function getRandomNumber() {
        return Math.floor(Math.random() * (34 - 4 + 1)) + 4;
    }

    function getImagePath(number) {
        return `/images/img${number}.jpg`;
    }

    function preloadImage(src) {
        return new Promise((resolve, reject) => {
            if (imageCache[src]) {
                resolve(imageCache[src]);
            } else {
                const img = new Image();
                img.onload = () => {
                    imageCache[src] = img;
                    resolve(img);
                };
                img.onerror = reject;
                img.src = src;
            }
        });
    }

    function setBackground(imagePath) {
        body.style.backgroundImage = `url(${imagePath})`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
    }

    function showContent() {
        contentBox.style.opacity = '1';
        contentBox.style.transform = 'scale(1)';
    }

    async function generateRandom() {
        const randomNum = getRandomNumber();
        randomNumberDisplay.textContent = 'Random Number: ' + randomNum;

        const imagePath = getImagePath(randomNum);
        setBackground(imagePath);
    }

    async function preloadAllImages() {
        const loadingIndicator = document.createElement('div');
        loadingIndicator.textContent = 'Loading images...';
        loadingIndicator.style.position = 'fixed';
        loadingIndicator.style.top = '10px';
        loadingIndicator.style.left = '10px';
        loadingIndicator.style.backgroundColor = 'rgba(255, 255, 255, 0.7)';
        loadingIndicator.style.color = 'black';
        loadingIndicator.style.padding = '10px';
        loadingIndicator.style.borderRadius = '5px';
        body.appendChild(loadingIndicator);

        const initialBatch = 10; // Number of images to load initially
        const imagePromises = [];

        // Load initial batch
        for (let i = 4; i <= 4 + initialBatch; i++) {
            const imagePath = getImagePath(i);
            imagePromises.push(preloadImage(imagePath));
        }

        try {
            await Promise.all(imagePromises);
            console.log('Initial batch of images preloaded successfully');
            generateRandom(); // Generate initial background after preloading initial batch
            showContent(); // Show the content box after loading initial batch

            // Load the rest of the images in the background
            for (let i = 4 + initialBatch + 1; i <= 34; i++) {
                const imagePath = getImagePath(i);
                preloadImage(imagePath).then(() => {
                    console.log(`Additional image ${i} loaded`);
                });
            }
        } catch (error) {
            console.error('Error preloading images:', error);
        } finally {
            loadingIndicator.remove();
        }
    }


    // About page functionality
    const faders = document.querySelectorAll('.fade-in-section');

    if (faders.length > 0) {
        faders.forEach(fader => {
            fader.classList.add('fade-out');
        });

        const appearOptions = {
            threshold: 0.1,
            rootMargin: "0px 0px -100px 0px"
        };

        const appearOnScroll = new IntersectionObserver(function (entries, appearOnScroll) {
            entries.forEach(entry => {
                if (!entry.isIntersecting) {
                    entry.target.classList.add('fade-out');
                    entry.target.classList.remove('is-visible');
                } else {
                    entry.target.classList.remove('fade-out');
                    entry.target.classList.add('is-visible');
                }
            });
        }, appearOptions);

        faders.forEach(fader => {
            appearOnScroll.observe(fader);
        });
    }
});


