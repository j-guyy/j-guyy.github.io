document.addEventListener('DOMContentLoaded', function () {
    const generateButton = document.getElementById('generateButton');
    const randomNumberDisplay = document.getElementById('randomNumber');
    const contentBox = document.querySelector('.content');
    const body = document.body;
    const imageCache = {};

    // Set initial background to black and hide content
    body.style.backgroundColor = 'black';
    body.style.transition = 'background-image 0.5s ease-in-out';
    if (contentBox) {
        contentBox.style.opacity = '0';
        contentBox.style.transform = 'scale(0.9)';
    }

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

    function setBackground(imagePath) {
        body.style.backgroundImage = `url(${imagePath})`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
    }

    function showContent() {
        if (contentBox) {
            contentBox.style.opacity = '1';
            contentBox.style.transform = 'scale(1)';
        }
    }

    function generateRandom() {
        const randomNum = getRandomNumber();
        if (randomNumberDisplay) {
            randomNumberDisplay.textContent = 'Random Number: ' + randomNum;
        }

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

        const initialBatch = 10;
        const imagePromises = [];

        for (let i = 4; i <= 4 + initialBatch; i++) {
            const imagePath = getImagePath(i);
            imagePromises.push(preloadImage(imagePath));
        }

        try {
            await Promise.all(imagePromises);
            console.log('Initial batch of images preloaded successfully');
            generateRandom();
            showContent();

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

    // Set up event listener for generate button
    if (generateButton) {
        generateButton.addEventListener('click', generateRandom);
    }

    // Start preloading images for the home page
    if (document.querySelector('.home-page')) {
        preloadAllImages();
    }

    // About page functionality
    if (document.querySelector('.about-page')) {
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

        // Parallax effect
        if (document.querySelector('.about-page')) {
            const parallax = document.querySelector('.parallax-background');
            const overlay = document.querySelector('.parallax-overlay');
            const totalHeight = document.body.scrollHeight - window.innerHeight;

            function updateParallax() {
                const scrolled = window.pageYOffset;
                const scrollProgress = scrolled / totalHeight;
                const moveDistance = parallax.offsetHeight - window.innerHeight;

                parallax.style.transform = `translateY(${-moveDistance * scrollProgress}px)`;
            }

            window.addEventListener('scroll', updateParallax);
            window.addEventListener('resize', function () {
                totalHeight = document.body.scrollHeight - window.innerHeight;
                updateParallax();
            });

            // Initial call to set the correct position
            updateParallax();
        }
    }
    if (document.querySelector('.travels-page')) {
        // Any specific JavaScript for the Travels page can go here
        console.log('Travels page loaded');
    }
});
