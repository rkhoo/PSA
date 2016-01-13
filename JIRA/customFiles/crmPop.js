
var upstream = upstream || {};
upstream.modules = upstream.modules || {};

upstream.modules.crmPop = (function ($) {
    var _isIe11 = /Trident\/7/.test(navigator.userAgent),
        _openCtiEnabled = /true/i.test(upstream.gadget.Config.extCRMOpenCti),
        _crmWin = null,
        _crmPop = function (crmid, task, trigger, callback) {

            var url = upstream.gadget.Config.baseUri + "/api/webpop/GetWebPopData/" + crmid;

            var reqObj = {};
            reqObj.TaskData = {};
            if (task) {
                var tmpTask = upstream.modules.utilities.serializable(task);

                reqObj.TaskData = tmpTask.TaskData;
                delete tmpTask["TaskData"];

                ["ChannelType", "ChannelSubType", "Id", "AcceptTime", "CreatedTime", "EpcStartTime", "StatusTimestamp"].forEach(function (prop) {
                    reqObj.TaskData[prop === "Id" ? "Task" + prop : prop] = tmpTask[prop];
                });

                reqObj.AgentDetails = tmpTask.AgentDetails;
                delete tmpTask["AgentDetails"];

                reqObj.Task = tmpTask;
            }
            reqObj.TriggerAction = trigger;
            var dataContext = JSON.stringify(reqObj);
            upstream.Logger.debug('_crmPop send data to provider', 'trigger action:{0} and Data:{1}', trigger, dataContext);
            upstream.gadgets.io.ajax({
                url: url,
                type: 'POST',
                cache: false,
                contentType: "application/json; charset=UTF-8",
                data: dataContext,
                dataType: 'json',
                xhrFields: { withCredentials: true },
                crossDomain: true,
                useMakeRequest: false,
                success: function (data) {
                    if (data) {
                        upstream.Logger.debug('crmPop success', 'trigger action:{0} and Data:{1}', trigger, JSON.stringify(data));

                        if (data.url) {
                            _opener(data.url, "extCrmWin", data.meta);
                        }
                        //else if (data.urls) {
                        //    $.each(data.urls, function (index, value) {
                        //        var name = "extCrmWin_" + index;
                        //        _openURL(value, name);
                        //    });
                        //}
						
						// RKRKRK: Oct 26, to send modified taskData for IC		
						if (data.meta.contactId) {
							var taskData = new Object;
							taskData.ContactId = "2468"; //data.meta.contactId;
							//taskData.UserId = data.meta.UserID;
							taskData.ContactName = "Sean s"; // data.meta.Name;
							//taskData.CountyID = data.meta.Department;
							//taskData.Title = data.meta.Title;							
							data.taskData = taskData;	
						}
						
                        if (callback && data.taskData) {
                            callback(data.taskData);
                        }
                    }
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    upstream.Logger.error("crmPop", "Error retrieving external CRM link");
                }
            });
        },
        _openURL = function (url, name, meta) {
            if (url !== "\"\"") {
                var nwargs = upstream.gadget.Config.extCRMWindowPrefs || "";
                var y = url.replace(/\"/g, "");
                
                if (!_crmWin || _crmWin.closed || _isIe11 || !_openCtiEnabled) {
                    // if crm window has not been opened or closed
                    _crmWin = window.open(y, name, nwargs);
                }

                if (meta && meta.contactId) {
                    // publish the event to xauth regardless of whether crm window opened or not
                    // because there may be existing salesforce opened which is not opened by finesse
                    // does not work in IE11
                    gadgets.Hub.publish("com.upstreamworks.events.crmPop", {
                        contactId: meta.contactId
                    });
                }
            }

        },
        _opener = _openURL;

    return {

        OpenCRMPop: function (crmId, task, trigger, callback) {
            _crmPop(crmId, task, trigger, callback);
        },

        AutoOpenCRMPop: function (task, trigger, callback) {
            var url = upstream.gadget.Config.baseUri + "/api/webpop/";
            var st = "";
            upstream.gadgets.io.ajax({
                url: url,
                type: 'GET',
                cache: false,
                contentType: "application/json; charset=UTF-8",
                dataType: "json",
                xhrFields: { withCredentials: true },
                crossDomain: true,
                success: function (data) {
                    for (var x in data) {
                        if (data.hasOwnProperty(x)) {
                            var c = data[x];
                            if (c && c.Auto) {
                                var allowPop = false;
                                if (c.TriggerActions) {
                                    var triggers = c.TriggerActions.split(",");
                                    if (triggers) {
                                        for (var i = 0; i < triggers.length; i++) {
                                            if (triggers[i] === trigger) {
                                                allowPop = true;
                                                break;
                                            }
                                        }
                                    }

                                }

                                if (allowPop)
                                    _crmPop(c.Id, task, trigger, callback);

                            }
                        }
                    }
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    upstream.Logger.error("Taskbar", "Error retrieving CRM actions");
                }
            });

        },

        RegisterCRMOpener: function (opener) {
            if (typeof opener !== "function") {
                upstream.Logger.error("crmPop", "Error registering CRM opener");
                return;
            }
            _opener = opener;
        }
    };
})(jQuery);