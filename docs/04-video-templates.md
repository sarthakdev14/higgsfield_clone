## New feature request -- Templates

We want to add a new feature to the video arena app. The feature is to allow users to create templates for longer videos.
The real appeal of a platform like this is if there is a 5-10 minute video a user can create. The problem is no video models spits out such a long video without hallucinations.
So we want to allow admins to create templates for longer videos. 

The template will be a bunch of videos (each video built from a base prompt and one avatar) that are stitched together to create a new longer form video. 

The admins can open a "template creator" UI (this can be hosted on /admins/template/create). Over here the admins should see a timeline very similar to the premere pro timeline. They should be able to add one audio track that will be the base audio for the full template video. The should be able to select a portion on the video (lets say 00:00:10 to 00:00:14) where they can decide to create a "video block".

A video block would be A prompt (with reference images, start image, end image, duration). The user should also be allowed to attach a face swap on the first image and the last image. If the face swap is enabled for this specific video block, We should first swap the face for the start frame or end frame or both, before we ask the model to generate the video. 

This series of video blocks should then be rendered (based on where they are on the timeline) and a final video should be created using an avatar for this specific admins profile.

This template should now be available to users on a new "Templates" tab where they can open a video template, see the cuirrent video, and if they want re-generate the video with their own avatar. 

This also means we need a new tab called "Avatar" where a user can come and put 1-2 images of themselves and we create an avatar for them. This avatar they can select before the generate a template video output for themselves. 

So overall , we need 
FRONTEND_URL/admin/template/create - For admins to create , test, video , update and finalise/export templates
FRONTEND_URL/user/avatar - For users to create their own avatar
FRONTEND_URL/user/templates - For users to see and generate videos from available templates.

One more feature we need is that whenever a template is exported, we should create a thumbnail for that template. 

When a user uses the template, we should generate a thumbnail for that user as well.

This means whenever a new template is created, the admin up front needs to tell how many avatars will be part of this template. For now only let the chose 1-2 avatars.

Make sure the frontend for the template creator is as close to the premiere pro timeline as possible. 
That is a familiar interface for the admins who will be creating this.

