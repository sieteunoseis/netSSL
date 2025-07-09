# Git Template Remote Script

A utility script for creating new projects from template repositories without creating a fork relationship.

## Overview

The `git-template-remote.sh` script allows you to:
- Clone a template repository
- Create a new standalone repository (not a fork)
- Set up proper remote tracking for future template updates
- Automatically create the new repository on GitHub

## Prerequisites

Before using this script, ensure you have:
- `git` installed
- `hub` CLI tool installed ([installation guide](https://github.com/github/hub#installation))
- GitHub authentication configured for hub

## Quick Download and Usage

Download the script directly from GitHub using wget:

```bash
# Download the script directly from GitHub
wget -O git-template-remote.sh https://raw.githubusercontent.com/sieteunoseis/react-express-tailwind-app/refs/heads/main/scripts/git-template-remote.sh

# Make it executable
chmod +x git-template-remote.sh

# Use the script
./git-template-remote.sh <template-repo-url> <new-project-name>
```

## Usage

```bash
./git-template-remote.sh <template-repo-url> <new-project-name>
```

### Parameters

- `template-repo-url`: The GitHub URL of the template repository
- `new-project-name`: The name for your new project (will be used as directory name and GitHub repo name)

### Example

```bash
./git-template-remote.sh https://github.com/sieteunoseis/react-express-tailwind-app.git my-awesome-project
```

## What the Script Does

1. **Clones the template**: Downloads the template repository to a new directory
2. **Renames the remote**: Changes `origin` to `upstream` to preserve template connection
3. **Prevents accidental pushes**: Sets upstream to `no_push` to avoid pushing changes back to template
4. **Creates new GitHub repo**: Uses hub CLI to create a new repository on GitHub
5. **Sets up origin**: Configures the new repository as the primary remote
6. **Initial push**: Pushes the template code to your new repository

## Remote Configuration

After running the script, your git remotes will be configured as:
- `origin`: Your new repository (for your project changes)
- `upstream`: The template repository (for receiving template updates, push disabled)

## Syncing Template Updates

To pull future updates from the template into your project:

```bash
git pull upstream main
```

Note: You may need to resolve merge conflicts if you've made changes to files that were also updated in the template.

## Troubleshooting

### Permission Denied
If you get permission errors:
```bash
chmod +x git-template-remote.sh
```

### Hub Not Found
Install the GitHub hub CLI:
- macOS: `brew install hub`
- Ubuntu/Debian: `sudo apt install hub`
- Or follow the [official installation guide](https://github.com/github/hub#installation)

### Authentication Issues
Ensure hub is authenticated with GitHub:
```bash
hub auth
```

## Credits

Script based on the guide: [Propagating Git Template Changes](https://www.mslinn.com/git/700-propagating-git-template-changes.html)