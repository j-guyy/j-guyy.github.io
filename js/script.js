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
    const body = document.body;
    const imageCache = {};

    // Set initial background to black
    body.style.backgroundColor = 'black';
    body.style.transition = 'background-image 0.5s ease-in-out';

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

        const imagePromises = [];
        for (let i = 4; i <= 34; i++) {
            const imagePath = getImagePath(i);
            imagePromises.push(preloadImage(imagePath));
        }

        try {
            await Promise.all(imagePromises);
            console.log('All images preloaded successfully');
        } catch (error) {
            console.error('Error preloading images:', error);
        } finally {
            loadingIndicator.remove();
            generateRandom(); // Generate initial background after preloading
        }
    }

    if (generateButton && randomNumberDisplay) {
        generateButton.addEventListener('click', generateRandom);
        preloadAllImages(); // Start preloading images immediately
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


