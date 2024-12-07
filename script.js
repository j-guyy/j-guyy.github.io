// Array of image filenames
const natureImages = [
    'img4.jpg', 'img5.jpg'
];

function getRandomImage() {
    return natureImages[Math.floor(Math.random() * natureImages.length)];
}

function generateRandom() {
    // Generate random number
    const randomNum = Math.floor(Math.random() * 100) + 1;
    document.getElementById('randomNumber').textContent = 'Random Number: ' + randomNum;

    // Set random background image
    document.body.style.backgroundImage = `url(${getRandomImage()})`;
}

// Set initial background image when the page loads
document.addEventListener('DOMContentLoaded', function () {
    document.body.style.backgroundImage = `url(${getRandomImage()})`;
});

// Attach event listener to the generate button
document.getElementById('generateButton').addEventListener('click', generateRandom);
