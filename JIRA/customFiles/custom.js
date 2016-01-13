/* Custom call variable script, maps cisco call vars to appropriate irdb constructs */
// NOTE: This script runs multiple times (each time TaskData changes) so any customization
//       *must* be able to handle that.
//
// History
// Oct 21, 2015	rkhoo	Created to use userMemberNumber
// Oct 22, 2.15 rkhoo	added URLOpener for the second URL
//
// [ Deployment v1 ]

var upstream = upstream || {};
upstream.custom = upstream.custom || {};

upstream.custom.TaskScript = (function ($) {
    var _logger = upstream.Logger,

    // A function to be invoked when a dial is executed successfully
    _onDialSuccess = function () {
        _logger.debug("TaskScript", "Successfully triggered outbound dial from custom.js");
    },

    // A function to be invoked when a dial fails
    _onDialError = function () {
        _logger.error("TaskScript", "Error when triggering outbound dial from custom.js");
    };

    return {
        // Called when a task is created from a dialog but before it is published to everyone
        // One use would be to change the channel type for special processing (be careful!)
        // activeTask - currently active task (CAN BE null if no active task)
        // newTask - newly created task to be published
        // dialog - Finesse dialog object (CAN BE null)
        // user - our User object
        // callbacks - available functions (CAN BE null or empty)
        ProcessTaskCreate: function (activeTask, newTask, dialog, user, callbacks) {
            _logger.debug("TaskScript", "Entering ProcessTaskCreate");

            // The following is some sample code showing how to change a Cisco dialog to something other
            // than a phone task. Note that it is also possible to optionally turn off the processing
            // of dialog disconnects (the default is 'true', they will be processed normally).
            //
            //if (dialog) {
            //    var mediaProperties = dialog.getMediaProperties();
            //    if (mediaProperties) {
            //        var account = mediaProperties["callVariable1"];
            //        if (account && (account === "148")) {
            //            _logger.debug("TaskScript", "Found special account! Changing Channel Type/Subtype");
            //            newTask.ChannelType = upstream.taskservices.ChannelType.WebRTC;
            //            newTask.ChannelSubType = upstream.taskservices.ChannelSubType.VideoChat;
            //            // newTask.ProcessDisconnects = false;
            //        }
            //    }
            //}

            // Always return 'true' 
            return true;
        },

        // Possible states: "Presenting", "Withdrawn", "Accept", "WrapUp", "Park", "Unpark", "Completed", "Deleted", "AfterComplete" (i.e. after logging), "PhoneDisconnect", "ChatDisconnect", "CRMClick"
        ProcessTaskState: function (task, user, state, callbacks) {
            return;
			if (state === 'CRMClick') {
				_logger.debug('CRM Btn Clicked in CustomJS', 'Data:{0}', task.taskData);
				
				//    callbacks.Dial.call(this, phoneNumber, _onDialSuccess, _onDialError);           
				//    callbacks.CompleteTask.call(this, task);

				var url = "https://10.33.10.191:8096/Service1/" + user.Details.Login;
				
				upstream.gadgets.io.ajax({
					url: url,
					type: 'GET',
					cache: false,
					contentType: "application/json; charset=UTF-8",                                                
					crossDomain: true,
					useMakeRequest: false,
					success: function (data) {
						if (data) {
							_logger.debug('CrmPopBtn success', 'Data:{0}', JSON.stringify(data));
							
							//TaskServices.notifyTaskdfataChanged()
						}
					},
					error: function (jqXHR, textStatus, errorThrown) {
						_logger.error("CrmPopBtn", "Error retrieving AD Result");
					}
				});
			}
			
        },

        ProcessTaskData: function (task, user, callback, options) {
            _logger.debug("TaskScript", "Entering ProcessTaskData");
            var that = this, accountNumber, contactReason, contactReasonDetail, membership;
            var data = {};

            if (task && task.TaskData) {
                // Create an empty sub-interaction *only* if none currently exists
                if (task.TaskData['interaction0'] === undefined) {
                    data =
                    {
                        "interaction0":
            	        {
            	            "SubInteractionId": 1
            	        }
                    };
                }
                else {
                    // Make sure the local data has the correct interaction0 if not created this pass
                    data.interaction0 = task.TaskData['interaction0'];
                }

                // Here's how to override the set state on Done behaviour by setting CompleteState in TaskData.
                // The value is of the form "Ready" or "NotReady:800" (where 800 is the desired NotReady code).
                // The following example will set the agent's state to Ready on Done of an outbound phone call.
                //if (task.getChannelType() === upstream.taskservices.ChannelType.Outbound) {
                //    data.CompleteState = "Ready";
                //}
                
                if (task.TaskData.userMemberNumber) {
                    data.MemberID = task.TaskData.userMemberNumber;
                }
				
                // data.interaction0.ContactReason = task.TaskData.callVariable2;
                // data.interaction0.ContactReasonDetail = task.TaskData.callVariable3;
                

                // Here's how to add properties to task data to disable logging to IRDB and/or UpTake for the current task
                //data.DisableIRDBLogging = true;
                //data.DisableUpTakeLogging = true;

                //to be populted by the right values by PS if need
 
                if (task.getChannelType() === upstream.taskservices.ChannelType.Inbound) {
                    //data.AdditionalValue1 = "test AdditionalValue1";
                    //data.AdditionalValue2 = "test AdditionalValue2 bla bla bla bla bla bla bla bla bla bla bla bla ";
                    //data.AdditionalValue3 = "test valuAdditionalValue3 <a href='http://www.google.com' target='blank'>www.google.com</a>";
                    //data.AdditionalValue1 = "Great Customer cheng";
                    //data.AdditionalValue2 = "<a href='http://www.examplewebsite.com'; target='blank'>www.examplewebsite.com</a>";
                    //data.AdditionalValue3 = "Finance";
                }                

                if (data) {
                    callback.call(that, task, data, options);
                }
            }
        },
		
		CrmUrlOpener: function (url, name, meta) {
			if (url != "http://google.com") {
				window.open(url, name);
				window.open(meta.POPURL2, "ADSearch");
			}
			
			return;
			
			// RKRKRK: Oct 26, if we need to try calling gadgets from here...
			if (true){
				
			}
			else {
				 if (meta && meta.ContactID) {
                    // publish the event to xauth regardless of whether crm window opened or not
                    // because there may be existing salesforce opened which is not opened by finesse
                    // does not work in IE11
                    upstream.gadgets.Hub.publish("com.upstreamworks.events.crmPop", {
                        contactId: meta.ContactId
                    });
                }
			}
		}
    };
}(jQuery));

(function (taskServices) {
    if (!taskServices) return; // exit because TaskServices is not available
    taskServices.registerTaskScript({
        onTaskCreate: upstream.custom.TaskScript.ProcessTaskCreate,
        onTaskDataChanged: upstream.custom.TaskScript.ProcessTaskData,
        onTaskStateChanged: upstream.custom.TaskScript.ProcessTaskState
    });
})(window.TaskServices);

(function (gadgets) {
    // overriding default querier for MediaSense for interaction viewer
    if (!gadgets || !gadgets.interactionViewer) return;  // exit because InteractionViewer is not available

    // uncomment below to override default recording querier
    //gadgets.interactionViewer.overrideQuery(function (epcId, login, renderer) {
    //    // query for recordings with given epcId and login
    //    // render recordings by calling renderer(data, [error_message])
    //    // - data is expected to be an array of json objects which contains { StartTimestamp: "...", Duration: "...", Url: "..." }
    //    // - message will be rendered instead of audio players if [error_message] is presented

    //    // if successfully retreived recordings
    //    //renderer([{
    //    //    StartTimestamp: Date.now(),
    //    //    Duration: 60,
    //    //    Url: "http://audio.upstreamworks.com/recording0.mp4"
    //    //}, {
    //    //    StartTimestamp: Date.now() + 120*1000,
    //    //    Duration: 60,
    //    //    Url: "http://audio.upstreamworks.com/recording1.mp4"
    //    //}]);


    //    // if error, replace with error messages
    //    //renderer(null, "Failed retrieving recordings.");
    //});
})(upstream.gadgets);

(function (modules){	
	modules.crmPop.RegisterCRMOpener(upstream.custom.TaskScript.CrmUrlOpener);
})(upstream.modules);