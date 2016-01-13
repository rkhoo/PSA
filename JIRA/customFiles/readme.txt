web.config of Gadgets services must have crmpop.js moved tot he end of path in the taskbar <> line.  
This is to allow customerJS to provide custom _URLopner()

crmpop.js is modifed to pass specific taskdata for updates.  
Note, if taskData is mapped to userStrings, then userStrings must also be updated here.  Like CountId=userString5.

InteractionCapture allows overides of taskData update so data will ineed gets updated even when there are data already in place.
