There is a slight un-optimisation in our current Export functionality. 
Even if a few videos are already baked, seems like the export pipeline re-generates them on openrouter. 

Only the ones that arent yet baked should be baked during export. 

The ones that already are should just be picked from the DB/minio