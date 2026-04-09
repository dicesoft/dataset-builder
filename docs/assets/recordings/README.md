# Terminal Recordings

Reproducible terminal recordings using [VHS](https://github.com/charmbracelet/vhs) by Charmbracelet.

## Installing VHS

**Go** (any platform):

```bash
go install github.com/charmbracelet/vhs@latest
```

**Homebrew** (macOS/Linux):

```bash
brew install charmbracelet/tap/vhs
```

**Scoop** (Windows):

```bash
scoop install vhs
```

VHS also requires [ffmpeg](https://ffmpeg.org/) and [ttyd](https://github.com/tsl0922/ttyd) to be installed.

## Generating GIFs

Run any `.tape` file to produce a GIF:

```bash
vhs docs/assets/recordings/hero-demo.tape
vhs docs/assets/recordings/pipeline-demo.tape
```

The output GIF will be written to the path specified in each tape file's `Output` directive.

## Available Tape Files

| File                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `hero-demo.tape`     | "Zero to Dataset" flow: scrape, transform, format         |
| `pipeline-demo.tape` | Full pipeline: scrape, transform to Q&A, format as Alpaca |

## Asset Guidelines

- **Width**: 900px (set in tape files)
- **Max file size**: Target under 5MB per GIF
- **Theme**: Dracula (dark background, consistent across all recordings)
- **Font size**: 14px
- Store generated GIFs in this directory alongside tape files

## Security Warning

**Never record commands that expose API keys or sensitive configuration.** Avoid recording:

- `npm start -- config set` commands with real API keys
- Any command that prints environment variables containing secrets
- Sessions where `.env` files or cookie files are visible
