# StepFlow

> Modern, minimalist Standard Operating Procedure (SOP) & workflow documentation creator.

StepFlow is a desktop application built with Electron, React, and TypeScript that enables teams and individuals to capture workflows, annotate screenshots, structure step-by-step procedures, and export polished SOP documents in multiple formats (PDF, Markdown, HTML, JSON). It also features an integrated Model Context Protocol (MCP) server for seamless AI assistant integration.

---

## ✨ Features

- **Desktop Screen Recording & Captures**: Capture full screen or window steps with automatic hotkeys.
- **Visual Step Annotation**: Annotate steps with callouts, numbered badges, arrows, highlights, and text labels using an interactive canvas.
- **Rich Procedural Editor**: Add titles, instructions, expected results, tips, warnings, and prerequisites for each step.
- **Multi-Format Export**: Export documentation to PDF, Markdown, HTML, PPTX, or ZIP packages.
- **Built-in MCP Server**: Expose SOP projects, steps, and procedures directly to AI agents via the Model Context Protocol (`@modelcontextprotocol/sdk`).
- **Cross-Platform**: Designed for macOS and Windows with native look, feel, and performance.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/JaipaNero/stepflow.git
cd stepflow
npm install
```

### Running Locally

To run the application in development mode with hot-reloading:

```bash
npm run dev
```

To run the Electron desktop app:

```bash
npm run electron
```

### Building for Production

Compile TypeScript and build the web bundle:

```bash
npm run build
```

Package the desktop app:

- **macOS**: `npm run dist:mac`
- **Windows**: `npm run dist:win`

---

## 🤖 Model Context Protocol (MCP) Server

StepFlow includes an MCP server allowing AI assistants (Claude, Cursor, Antigravity, etc.) to list, read, search, and manage SOP projects:

```bash
# Build the MCP server
npm run build:mcp

# Run the MCP server
npm run mcp
```

Or configure it in your MCP settings (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "stepflow": {
      "command": "node",
      "args": ["/path/to/stepflow/dist-electron/electron/mcp-server.js"]
    }
  }
}
```

---

## 🛠️ Tech Stack

- **Framework**: [Electron](https://www.electronjs.org/) + [React](https://react.dev/)
- **Bundler & Tooling**: [Vite](https://vitejs.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Canvas / Graphics**: [Konva](https://konvajs.org/) / [react-konva](https://github.com/konvajs/react-konva)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Protocol**: [Model Context Protocol](https://modelcontextprotocol.io/)

---

## 📄 License

MIT License.
