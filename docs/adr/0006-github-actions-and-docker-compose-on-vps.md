# Deploy Docker images to the VPS with GitHub Actions

We will use GitHub Actions for CI/CD and Docker Compose on the VPS for runtime orchestration. On pushes to the main branch, CI will test and build the web, API, and worker images, push them to GitHub Container Registry, then SSH into the VPS so Docker Compose can pull the updated images and restart the changed services. This gives the two-person team a free, standard deployment path without operating a separate Jenkins server.
