// We don't need the natureImages array anymore since we're using a fixed range

function getRandomNumber() {
    // Generate a random number between 4 and 34 (inclusive)
    return Math.floor(Math.random() * (34 - 4 + 1)) + 4;
}

function getImagePath(number) {
    // Generate the image path based on the number
    return `css/images/img${number}.jpg`;
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
    generateRandom(); // This will set an initial random number and background
});

// Attach event listener to the generate button
document.getElementById('generateButton').addEventListener('click', generateRandom);
