# Timelapse Studio

A web-based tool to create smooth timelapse videos from a sequence of photos.

![Timelapse Studio Screenshot](docs\screenshot.png)

## Features
- **Batch Upload**: Upload hundreds of photos at once.
- **Customizable Settings**:
    - Frame Rate (FPS)
    - Output Resolution (1080p, 4K, 720p, Original)
    - Aspect Scaling (Contain, Cover, Stretch)
    - Video Format (MP4, WebM)
    - Render Quality (High, Balanced, Fast)
- **Real-time Progress**: Watch the encoding progress with live status updates via SSE (Server-Sent Events).
- **Instant Preview**: View and download your generated timelapse immediately.

## Prerequisites
- **Node.js** (v14+ recommended)
- **FFmpeg** installed on your system and available in your PATH.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/jaleks71/timelapse-studio.git
    cd timelapse-studio
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the application:**
    ```bash
    npm start
    ```

4.  **Access the app:**
    Open your browser and navigate to `http://localhost:3000`.

## Usage
1.  Drag and drop your sequence of photos into the upload area.
2.  Adjust your desired settings (FPS, Resolution, etc.).
3.  Click **"Generate Timelapse Video"**.
4.  Once finished, your video will appear in the preview panel for viewing and downloading.

## Development & Testing

The `scripts/` directory contains utilities for local development and testing:

-   **Generate test photos:**
    ```bash
    node scripts/generate-700-photos.js
    ```
    Creates 700 BMP test frames in a `test_photos/` directory with smooth color-shifting gradients and a moving progress bar — useful for testing the full pipeline without needing real photos.

-   **Run end-to-end test:**
    ```bash
    node scripts/test-e2e.js
    ```
    Uploads all 700 generated test photos in batches and triggers two render passes (1080p @ 30 FPS and 4K @ 60 FPS), verifying that output videos are created successfully. Requires the server to be running.

## Technologies Used
- **Backend**: Node.js, Express, Multer, CORS
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Processing**: FFmpeg

## Credits & Dependencies
- [FFmpeg](https://ffmpeg.org/): Used for video encoding and processing.
- [Express](https://expressjs.com/): Web framework for the backend.
- [Multer](https://github.com/expressjs/multer): Middleware for handling multipart/form-data.
- [CORS](https://github.com/expressjs/cors): Middleware for enabling Cross-Origin Resource Sharing.

## Contributing

Contributions are welcome! If you have ideas for new features, spot a bug, or want to improve the documentation, feel free to:

1.  Fork the repository
2.  Create a feature branch (`git checkout -b feature/my-improvement`)
3.  Commit your changes (`git commit -m 'Add my improvement'`)
4.  Push to the branch (`git push origin feature/my-improvement`)
5.  Open a Pull Request

Bug reports and feature requests via [Issues](https://github.com/jaleks71/timelapse-studio/issues) are also appreciated!

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
# timelapse-studio
