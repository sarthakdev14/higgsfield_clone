## Building a Video generating Saas
You have an empty turbo repo that we want to setup for a new project that I'm building. That project is awfully close to what higgsfield does, for now let users come and generate a video based on a prompt, duration, resolution, aspect ratio, start frame, end frame and reference frames. 

## Step 1 
For now we want to setup all the services needed for this. The Architecture looks as follows - 
 - Frontend - A react frontend that the user will land to to interact with our systems. Use bun to intialise the react project.
 - Backend - A Typescript + Express Backend which exposes the CRUD endpoints for the user.
 - Postgres + Prisma - The Database layer. We should write all the prisma logic in a saparate package called db and re-use this package in the backend app
 - MinIO as the Object store - For now we'd like to use minio as the local object store
 - Self hostel Face fusion for face swap (we will need this later not right now but lets add it to the docker compose)
 - Openrouter as the video model routing layer. https://openrouter.ai/docs/guides/overview/multimodal/video-generation

For now, lets initialise all the packages/apps. Lets write the dockerfiles for it. Lets also write a docker compose that lets the user start these services locally. We should also populate the steps to start the project locally in the README file. We should update agents.md to do the same. Also add .env.example files to all the projects

## Step 2 
Frontend - The Navbar should have only one tab for now - Video. On the right side it should have a signin/profile button. Create the login page, authentication modal, video creation page which has two tabs. 
a. Text to video generation
    - User should be able to select the model, duration, resolution, aspect ratio, start frame, end frame and reference frames. Some of these would be optional. No need to show any pricing right now.
b. See your existing videos

Backend - Add support for authentication using Google and email. Add logic to talk to openrouter synchronously for now. Make sure all final videos and images (uploaded by users or fetched from openrouter) are dumped to our Object store. 

Whatever env variables are needed eventually (openrouter key/google oauth secrets) I will provide later, for now add them to .env.example. 

By the end, also add commands in the top level package.json to start the full project locally using docker-compose.