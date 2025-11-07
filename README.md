# MyWhiteboard - Music Chart Manager

A clean, modern web application for musicians to manage and view PDF music charts during rehearsals and performances.

## Features

### 🎵 Two User Roles

#### Music Director (MD)
- Create private sessions with unique 6-character codes
- Upload multiple PDF music charts via drag-and-drop or file browser
- Share session codes with musicians
- Manage uploaded charts (add/remove)

#### Musician
- Join sessions using session codes
- View all uploaded charts
- Add real-time annotations on PDF pages
- Navigate between charts and pages seamlessly

### 📊 Two Viewing Modes

#### Concert Mode
- Single-page view for performances
- Full-screen PDF display using native browser rendering
- Keyboard navigation (arrow keys)
- Real-time annotation overlay
- Perfect for live performances

#### Organize Mode
- Grid view of all uploaded charts
- Quick navigation between different pieces
- Visual overview of the entire repertoire
- Click any chart to jump to it in concert mode

### ✏️ Real-Time Annotations
- Draw annotations directly on PDF pages
- Annotations persist per page
- Toggle annotation mode on/off
- Touch-screen support for tablets
- Red pen style for visibility

### 🔒 Session Management
- Cryptographically secure session codes
- Private sessions stored in browser localStorage
- Multiple musicians can join the same session
- No server required - works entirely in the browser

## Getting Started

### Requirements
- Modern web browser (Chrome, Firefox, Safari, Edge)
- No installation or build process needed

### Running Locally

1. Clone the repository:
```bash
git clone https://github.com/KingTeky/MyWhiteboard.git
cd MyWhiteboard
```

2. Start a local web server:
```bash
# Using Python 3
python3 -m http.server 8080

# Or using Node.js
npx http-server -p 8080
```

3. Open your browser and navigate to:
```
http://localhost:8080
```

### Running the optional development server (client + API)

This project also includes a lightweight development server under `server/` that provides:
- Session persistence and server-backed sessions (useful for multi-device testing)
- WebSocket-based live updates for chart/page changes and chat
- API endpoints under `/api/sessions`

To run both the static client server and the API server together (recommended for development):

```powershell
npm run dev
```

This script starts a static file server on port 8080 and the API server on port 3000. The frontend will talk to the API at `http://localhost:3000` by default.

Environment variables (optional):
- `NEW_SESSION_GRACE_MS` — grace window (ms) to avoid deleting brand-new sessions before clients subscribe (default: 5000)
- `DIRECTOR_DISCONNECT_GRACE_MS` — how long (ms) to wait after a director WS disconnect before deleting the session (default: 30000)

Session lifecycle notes
- The server will delete sessions when the director explicitly leaves or after inactivity, but the client now opens the websocket immediately after creating a session and persists the director token in localStorage so deletes and saves are authorized and reliable.


## Usage Guide

### For Music Directors

1. Click **"Create Session"** on the landing page
2. Note the 6-character session code displayed
3. Upload PDF music charts by:
   - Dragging and dropping files onto the upload area
   - Clicking "Browse Files" to select files
4. Click **"Start Session"** when all charts are uploaded
5. Share the session code with your musicians

### For Musicians

1. Get the session code from your Music Director
2. Enter the code in the **"Join Session"** input field
3. Click **"Join Session"**
4. Use the toolbar to:
   - Switch between Concert and Organize modes
   - Enable annotations
   - Navigate between charts

### Keyboard Shortcuts

- **Left Arrow**: Previous page
- **Right Arrow**: Next page
- **Up Arrow**: Previous chart
- **Down Arrow**: Next chart

## Technical Details

### Architecture
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **PDF Rendering**: Native browser PDF viewer via iframe
- **Storage**: Browser localStorage for session data
- **Security**: 
  - Cryptographically secure session codes using `crypto.getRandomValues()`
  - HTML escaping to prevent XSS attacks
  - Event delegation instead of inline handlers

### Browser Compatibility
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Modern mobile browsers

### File Structure
```
MyWhiteboard/
├── index.html      # Main HTML structure
├── styles.css      # All styling and responsive design
├── app.js          # Application logic and state management
├── .gitignore      # Git ignore rules
└── README.md       # This file
```

## Design Philosophy

- **Minimal animations**: Subtle transitions only, no distracting effects
- **Clean interface**: Focus on the music, not the UI
- **Performance**: Lightweight, no external frameworks
- **Accessibility**: Semantic HTML and keyboard navigation
- **Responsive**: Works on desktop, tablet, and mobile devices

## Security Features

- Secure random session code generation
- XSS protection through HTML escaping
- No inline event handlers
- Strict equality checks throughout
- Input validation and sanitization

## Limitations

- Session data is stored locally (not synchronized across devices)
- PDF rendering depends on browser capabilities
- No real-time collaboration (annotations are local only)
- Session data persists only in the current browser

## Future Enhancements

Potential improvements for future versions:
- Backend server for session synchronization
- Real-time collaboration with WebSockets
- Cloud storage for PDFs
- User accounts and authentication
- More annotation tools (colors, shapes, text)
- Export annotated PDFs
- Mobile app versions

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the MIT License.

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

## Smoke test (quickjump)

There is a small smoke test that uses jsdom to verify the Quick Jump module updates when charts are added, removed, or reordered.

Run the test locally:

1. Install jsdom as a dev dependency:

```bash
npm install jsdom --save-dev
```

2. Run the smoke script:

```bash
node tests/quickjump-smoke.js
```

The script will print PASS on success or an error message if Quick Jump did not update as expected.