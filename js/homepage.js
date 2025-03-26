document.addEventListener('DOMContentLoaded', function () {

    // Background image functionality
    const body = document.body;
    let currentImageNumber = 4;
    const maxImageNumber = 34;
    const imageCache = {};

    // Set initial body styles
    body.style.margin = '0';
    body.style.transition = 'background-image 1s ease-in-out';
    body.style.backgroundSize = 'cover';
    body.style.backgroundPosition = 'center';
    body.style.backgroundRepeat = 'no-repeat';

    // Preload function for a single image
    function preloadImage(imageNumber) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                imageCache[imageNumber] = img;
                resolve(img);
            };
            img.onerror = reject;
            img.src = `images/img${imageNumber}.jpg`;
        });
    }

    // Preload all images
    async function preloadAllImages() {
        const preloadPromises = [];
        for (let i = 4; i <= maxImageNumber; i++) {
            preloadPromises.push(preloadImage(i));
        }
        try {
            await Promise.all(preloadPromises);
            console.log('All images preloaded successfully');
            // Start the slideshow after all images are loaded
            startSlideshow();
        } catch (error) {
            console.error('Error preloading images:', error);
        }
    }

    function updateBackgroundImage() {
        body.style.backgroundImage = `url(images/img${currentImageNumber}.jpg)`;

        // Increment image number or reset to 4
        currentImageNumber++;
        if (currentImageNumber > maxImageNumber) {
            currentImageNumber = 4;
        }
    }

    function startSlideshow() {
        // Set initial background
        updateBackgroundImage();
        // Start the interval
        setInterval(updateBackgroundImage, 3000);
    }

    // Set initial background and start preloading
    body.style.backgroundImage = `url(images/img4.jpg)`;
    preloadAllImages();

    // Add animation delays to each letter
    const letters = document.querySelectorAll('.content h1 span');
    letters.forEach((letter, index) => {
        letter.style.animationDelay = `${index * 0.1}s`;
    });

    // Function to adjust container height
    function adjustContainerHeight() {
        const container = document.querySelector('.home-page .container');
        container.style.height = `${window.innerHeight}px`;
    }

    // Adjust container height on load and resize
    adjustContainerHeight();
    window.addEventListener('resize', adjustContainerHeight);

});
