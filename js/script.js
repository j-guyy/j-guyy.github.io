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

    if (generateButton && randomNumberDisplay) {
        const imageCache = {};

        function getRandomNumber() {
            return Math.floor(Math.random() * (34 - 4 + 1)) + 4;
        }

        function getImagePath(number) {
            return `images/img${number}.jpg`;
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

        function setBackgroundWithFade(imagePath) {
            const newBackground = document.createElement('div');
            newBackground.style.backgroundImage = `url(${imagePath})`;
            newBackground.style.position = 'fixed';
            newBackground.style.top = '0';
            newBackground.style.left = '0';
            newBackground.style.width = '100%';
            newBackground.style.height = '100%';
            newBackground.style.zIndex = '-1';
            newBackground.style.opacity = '0';
            newBackground.style.transition = 'opacity 0.5s ease-in-out';
            newBackground.style.backgroundSize = 'cover';
            newBackground.style.backgroundPosition = 'center';

            body.appendChild(newBackground);

            // Trigger reflow
            newBackground.offsetHeight;

            newBackground.style.opacity = '1';

            // Remove old background after transition
            setTimeout(() => {
                const oldBackground = body.querySelector('.background-image:not(:last-child)');
                if (oldBackground) {
                    oldBackground.remove();
                }
                newBackground.classList.add('background-image');
            }, 500);
        }

        async function generateRandom() {
            const randomNum = getRandomNumber();
            randomNumberDisplay.textContent = 'Random Number: ' + randomNum;

            const imagePath = getImagePath(randomNum);

            try {
                await preloadImage(imagePath);
                setBackgroundWithFade(imagePath);
            } catch (error) {
                console.error('Failed to load image:', error);
            }
        }

        generateButton.addEventListener('click', generateRandom);
        generateRandom(); // Generate initial number and background
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


