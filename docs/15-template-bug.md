Theres a bug in the "generate with my avatar" functionality for a template. 

When I am exporting with a new avatar, it is not working. The avatar is not being used in the export. 

Seems like it is simply using the original video instead of the new avatar.

We should start a longer pipeline that actually re-generates all the video blocks for this user and finally merges them to create the final template video.

Also, during this process we should ensure we are not re-baking 2 same video blocks for the same avatar.

Also , we should probably paralellise creating these on openrouter, no need for the process to be sequential.