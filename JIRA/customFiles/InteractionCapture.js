/*****************************************************************************
 *
 * File:         InteractionCapture.js
 *
 * Platform:     Microsoft .Net 4.0
 *
 * Contents:
 *
 * Remarks:
 *
 * Copyright:    (C) 2012 Upstream Works Software Ltd.
 *
 * Modifications:
 *
 * When          Who           What
 * ----          ----          ----
 * 2012/02/03    D Schimmer    Created.
 * 2014/02/24    F Martinello  Changed to populate on type change
 * 2014/06/10    F Martinello  added ServiceLevelIndicator and TaskSource _task2epc
 * 2015/05/12    B McKie       Reason Detail requirements, if no values in set, not required
* 2015/10/26     R Khoo         Allow CRMBtn to set taskData change override=true	
 *****************************************************************************/
var upstream = upstream || {};
upstream.modules = upstream.modules || {};
upstream.modules.InteractionCapture = (function ($) {
    "use strict";
    var _GADGET_TAG = "InteractionCapture",
        _hub,
        _prefs,
        _loadingConfig,
        _loadingIntervalEventID,
        _activeTaskId,
        _user,
        _interactions = {},
        _activeTask,
        _timeIntervalEventID,
        _localization = upstream.gadget.locale,
        _lastAutoSaveString = null,
        _disableDataDip = [],

        _processTaskStateChanged = function (notify) {
            upstream.Logger.debug('InteractionCapture', '_processTaskStateChanged "{0}" "{1}"', notify.NewBaseState,
                                   notify.Task ? notify.Task.Id : "null");

            if ((notify.NewBaseState === 'Presenting') || (notify.NewBaseState === 'Withdrawn')) {
                upstream.Logger.debug('InteractionCapture', 'Ignoring Presenting/Withdrawn state');
                return;
            }

            if (notify.NewBaseState !== notify.PreviousBaseState) {
                if (notify.Task) {
                    _autoSaveTask(notify.Task, '_processTaskStateChanged');

                    if (notify.NewBaseState === 'Completed') {
                        _completeTask(notify.Task);
                        // TODO: log elapsed time
                        _logTime("end", notify.Task.getEpcId());
                    } else if (notify.NewBaseState === 'Deleted') {
                        _removeTask(notify.Task.Id);
                    }

                }

            }
        },

        _processTaskDataChanged = function (notify) {
            if (notify === null) {
                upstream.Logger.error('InteractionCapture', '_processTaskDataChanged NULL notify!');
            }

            upstream.Logger.debug('InteractionCapture', '_processTaskDataChanged "{0}" changedValues: {1}',
                                   notify.task ? notify.task.Id : "null", notify.changedValues ? "true" : "false");

            if (!notify.task || !notify.changedValues)
                return;

            upstream.Logger.debug('InteractionCapture', 'BaseState: "{0}"', notify.task.getBaseState());
            if (notify.task.getBaseState() === 'Presenting') {
                upstream.Logger.debug('InteractionCapture', 'Ignoring Presenting state');
                return;
            }

            for (var property in notify.changedValues) {
                upstream.Logger.debug('InteractionCapture', 'Got: "{0}":"{1}"',
                                        property, JSON.stringify(notify.changedValues[property]));
            }

            _updateTask(notify.task, notify.changedValues, notify.options);
            _autoSaveTask(notify.task, '_processTaskDataChanged');
        },

        _grabSubInteractionTaskData = function (tabArea) {
            var $tabPages = tabArea.find('div[data-sub-id]');

            // Iterate through the entries building the TaskData
            var taskData = {};
            $.each($tabPages, function (idx, value) {
                var interaction = _getInteractionData($(value));
                if (!interaction) return;

                taskData['interaction' + idx] = JSON.stringify(interaction);
            });

            return taskData;
        },

    _task2Epc = function (task) {
        var $task, epc, $contactAreaFields, $contactFields, fieldValue, $interactionArea, $interactionAreaTabs, interactionId, taskId = task.Id, interaction, $interactionFields, prefs = new gadgets.Prefs();

        if (!Date.prototype.toISOString) {
            (function () {
                function pad(number) {
                    var r = String(number);
                    if (r.length === 1) {
                        r = '0' + r;
                    }
                    return r;
                }

                Date.prototype.toISOString = function () {
                    return this.getUTCFullYear()
                    + '-' + pad(this.getUTCMonth() + 1)
                    + '-' + pad(this.getUTCDate())
                    + 'T' + pad(this.getUTCHours())
                    + ':' + pad(this.getUTCMinutes())
                    + ':' + pad(this.getUTCSeconds())
                    + '.' + String((this.getUTCMilliseconds() / 1000).toFixed(3)).slice(2, 5)
                    + 'Z';
                };
            }());
        }

        if (!Date.now) {
            Date.now = function now() {
                return new Date().getTime();
            };
        }


        if (!task.WrapUpTime) {
            // No wrapup time for this item so start of wrapup same as complete time
            task.WrapUpTime = task.CompleteTime;
        }

        var queueTimeMs = 0;
        var totalCustomerTimeMs = 0;
        var SLA = null, PastCriticalSLA = null;
        var presentingTime = task.PresentingTime;
        var autoCompleted = false;
        var disableIRDBLogging = false;
        var disableUpTakeLogging = false;
        var isTaskTakenOver = null;
        var originalUserId = null;
        var start_Status = null;
        var termination_Status = null;
        var consultOutCount = null;
        var transferDestination = null;
        var subject = null;
        try {
            // channels to skip queue time calculation
            var skipchannels = [1, 2, 6, 7, 8, 9];

            var epcStartTime = task.EpcStartTime;
            if (!epcStartTime) {
                epcStartTimetask.TaskData.EpcStartTime ? task.TaskData.EpcStartTime : task.TaskData.SystemEntryTime;

                if (epcStartTime) {
                    epcStartTime = _dateFromString(epcStartTime);
                }
            }

            if (epcStartTime) {
                if (task.PresentingTime) {
                    if (task.PresentingTime > epcStartTime && skipchannels.indexOf(task.ChannelType) == -1)
                        queueTimeMs = task.PresentingTime - epcStartTime;
                }
                else if (task.TaskData && task.TaskData.PresentingTime) {//if time objects are null get them from the taskData object              
                    presentingTime = _dateFromString(task.TaskData.PresentingTime);
                    if (presentingTime > epcStartTime && skipchannels.indexOf(task.ChannelType) == -1)
                        queueTimeMs = presentingTime - epcStartTime;
                }

                if (task.WrapUpTime) {
                    if (task.WrapUpTime > epcStartTime)
                        totalCustomerTimeMs = task.WrapUpTime - epcStartTime;
                }
                else if (task.TaskData && task.TaskData.WrapUpTime) {//if time objects are null get them from the taskData object
                    var wrapUpTime = _dateFromString(task.TaskData.WrapUpTime);
                    if (wrapUpTime > epcStartTime)
                        totalCustomerTimeMs = wrapUpTime - epcStartTime;

                }
            }

            if (task.AcceptTime && task.TaskData.ExpectedHandleByTime && (task.AcceptTime <= _dateFromString(task.TaskData.ExpectedHandleByTime))) {
                SLA = true;
            }
            if (task.AcceptTime && task.TaskData.ExpectedHandleByTime && (task.AcceptTime > _dateFromString(task.TaskData.ExpectedHandleByTime))) {
                SLA = false;
            }


            if (task.AcceptTime && task.TaskData.CriticalSLATime) {
                if (task.AcceptTime <= _dateFromString(task.TaskData.CriticalSLATime))
                    PastCriticalSLA = false;
                else
                    PastCriticalSLA = true;
            }

            if (task.TaskData && task.TaskData.termination_Status) {
                termination_Status = task.TaskData.termination_Status;
            }
            if (task.AutoCompleted === true) {
                autoCompleted = true;
            }
            if (task.TaskData && task.TaskData.DisableIRDBLogging === true) {
                disableIRDBLogging = true;
            }
            if (task.TaskData && task.TaskData.DisableUpTakeLogging === true) {
                disableUpTakeLogging = true;
            }
            if (task.TaskData && task.TaskData.IsTaskTakenOver) {
                isTaskTakenOver = task.TaskData.IsTaskTakenOver;
            }
            if (task.TaskData && task.TaskData.OriginalUserId) {
                originalUserId = task.TaskData.OriginalUserId;
            }
            if (task.TaskData && task.TaskData.StartStatus) {
                start_Status = task.TaskData.StartStatus;
            }
            if (task.TaskData && task.TaskData.startObject) {
                var obj = task.TaskData.startObject;
                if (obj.calltype === 'PREROUTE_ACD_IN' && obj.state === 'ACTIVE') {
                    start_Status = 0; //Normal
                }
                else if (obj.calltype === 'TRANSFER' && obj.state === 'ACTIVE') {
                    start_Status = 2; //Transferred
                }
                else if ((obj.calltype === 'OUT' || obj.calltype === 'OUTBOUND' || obj.calltype === 'OUTBOUND_PREVIEW') && obj.state === 'ACTIVE') {
                    start_Status = 0 // out bound call start
                }
                else start_Status = 3; //Consult
            }
            if (task.TaskData && task.TaskData.endObject) {
                var obj = task.TaskData.endObject;
                if (obj.calltype === 'TRANSFER' && obj.state === 'DROPPED') {
                    termination_Status = 2; //Transferred
                }
                else if ((obj.calltype === 'CONSULT' && obj.state === 'DROPPED') ||
                         (obj.calltype === 'CONSULT' && obj.state === 'WRAP_UP')) {
                    termination_Status = 3; //Consult
                }
                else {
                    termination_Status = 0; //Normal
                }
            }
            if (task.TaskData && task.TaskData.TransferDestination) {
                transferDestination = task.TaskData.TransferDestination;
            }
            if (task.TaskData && task.TaskData.startObject && task.TaskData.startObject.toAddress) {
                if ((start_Status == 0 && termination_Status == 2) ||
                    (start_Status == 0 && termination_Status == 0) ||
                    (start_Status == 3 && termination_Status == 2) ||
                    (start_Status == 2 && termination_Status == 2)) {
                    transferDestination = task.TaskData.startObject.toAddress;
                }
            }
            if (task.TaskData && task.TaskData.startObject && task.TaskData.startObject.COC) {
                if ((start_Status == 0 && termination_Status == 2) ||
                    (start_Status == 0 && termination_Status == 0) ||
                    (start_Status == 3 && termination_Status == 2) ||
                    (start_Status == 2 && termination_Status == 2)) {
                    consultOutCount = task.TaskData.startObject.COC;
                }
            }
            if (task.TaskData && task.TaskData.subject) {
                subject = task.TaskData.subject;
            } else if (task.TaskData && task.TaskData.InitialMessage) {
                subject = task.TaskData.InitialMessage;
            }
        }
        catch (err) {
            upstream.Logger.error('InteractionCapture', 'Error calculating queuetime, totalcusotmertime or sla "{0}"', err.message);
        }

        epc = {
            Id: task.getId(),
            EpcId: task.getEpcId(),
            ChannelType: task.getChannelType(),
            ChannelSubType: task.getChannelSubType(),
            ExtEpcId: task.ExternalEpcId,
            StartDateTime: epcStartTime ? epcStartTime : task.CreatedTime,
            PresentingTime: presentingTime,
            EndDateTime: task.CompleteTime,
            QueueTimeMs: queueTimeMs,
            TimeToServiceSec: task.TaskData.TimeToServiceSec,
            TotalCustomerTimeMs: totalCustomerTimeMs,
            IsValid: task.TaskData.IsValid,
            TaskSource: task.TaskData.TaskSource,
            ServiceLevelIndicator: task.TaskData.ServiceLevelIndicator,
            SystemEntryTime: task.TaskData.SystemEntryTime,
            AllocatedSkillId: task.TaskData.AllocatedSkill,
            IsSLA: SLA,
            IsPastCriticalSLA: PastCriticalSLA,
            InteractionStartTime: task.AcceptTime,
            RelatedEpcId: task.RelatedEpcId,
            ParentEpcId: task.ParentEpcId,
            AutoCompleted: autoCompleted,
            DisableIRDBLogging: disableIRDBLogging,
            DisableUpTakeLogging: disableUpTakeLogging,
            OriginalUserId: originalUserId,
            IsTaskTakenOver: isTaskTakenOver,
            agent: {
                interactions: []
            },
            StartStatus: start_Status,
            TerminationStatus: termination_Status,
            ConsultOutCount: consultOutCount,
            TransferDestination: transferDestination,
            Subject: subject
        };

        // find the task in the area and kill it.
        $task = $('#task-area > #' + taskId);

        $contactAreaFields = $task.find('.task-contact-area').children();
        $contactFields = $contactAreaFields.find('[name]');
        epc.viewModelId = $contactAreaFields.find('[data-viewmodel-id]:selected').data('viewmodel-id') || "";

        $.each($contactFields, function (idx, value) {
            fieldValue = $(value).val();
            if (value.tagName === 'SELECT') {
                if (!isNaN(fieldValue)) {
                    epc[value.id] = Number(fieldValue);
                }
            } else if ($(value).is(":checkbox")) {
                epc[value.id] = $(value).prop('checked');
            } else {
                fieldValue = $(value).val();

                if (fieldValue) {
                    epc[value.id] = fieldValue;
                }
            }
        });
        $interactionArea = $task.find('.task-reason-tab-area');
        $interactionAreaTabs = $interactionArea.find('div[data-sub-id]');

        $.each($interactionAreaTabs, function (idx, value) {
            interaction = null;
            $interactionFields = $(value).find('[name]');

            if ($interactionFields.length > 0) {
                try {
                    interaction = {};
                    interaction.SubInteractionId = Number($(value).attr('data-sub-id'));
                    interaction.viewModelId = $(value).find('[data-viewmodel-id]:selected').last().data('viewmodel-id') || "";
                    $.each($interactionFields, function (index, control) {
                        fieldValue = $(control).val();
                        if (control.tagName === 'SELECT') {
                            if (!isNaN(fieldValue)) {
                                interaction[control.id] = Number(fieldValue);
                            }
                        } else if (control.tagName === 'TEXTAREA') {
                            if (fieldValue) {
                                interaction[control.name] = fieldValue;
                            }
                        } else if ($(control).is(":checkbox")) {
                            interaction[control.id] = $(control).prop('checked');
                        } else {
                            if (fieldValue) {
                                interaction[control.id] = fieldValue;
                            }
                        }
                    });

                    // validate....
                    if (interaction.ContactReason) {
                        epc.agent.interactions.push(interaction);
                    }
                }
                catch (err) {
                    upstream.Logger.error('InteractionCapture', 'Error with interaction "{0}"', err.message);
                }
            }
        });

        if (_user) {
            try {
                epc.agent.DisplayName = _user.getFirstName() + ' ' + _user.getLastName();
            }
            catch (err) {
                upstream.Logger.error('InteractionCapture', 'error making user name "{0}"', err.message);
            }
        }

        try {
            epc.agent.UserName = prefs.getString("id");
            // temp hardcoded dummy data
            epc.agent.AgentSessionId = "a1b2c3d4e5f6g7h8";
            epc.agent.ActiveTimeMs = (task.HandledTime[upstream.taskservices.BaseState.Live] * 1000);
            epc.agent.SuspendTimeMs = (task.Duration[upstream.taskservices.BaseState.Live] - task.HandledTime[upstream.taskservices.BaseState.Live]) * 1000;

            // Compute some of the special time values

            // Set defaults
            epc.agent.PresentingTimeMs = 0;
            epc.agent.WrapupTimeMs = 0;

            // Compute values based on time values
            if (task.PresentingTime && task.AcceptTime && (task.AcceptTime > task.PresentingTime)) {
                epc.agent.PresentingTimeMs = task.AcceptTime - task.PresentingTime;
            }
            if (task.WrapUpTime && task.CompleteTime && (task.CompleteTime > task.WrapUpTime))  // phone type only
            {
                // wrap up duration - suspended duration after wrap up
                //epc.agent.WrapupTimeMs = (task.CompleteTime - task.WrapUpTime) - epc.agent.SuspendTimeMs;
                epc.agent.WrapupTimeMs = task.HandledTime[upstream.taskservices.BaseState.WrapUp] * 1000;
                epc.agent.ActiveTimeMs = task.WrapUpTime - task.AcceptTime;
            }

            // Store the various time markers
            epc.agent.PresentingTime = task.PresentingTime;
            epc.agent.AcceptTime = task.AcceptTime;
            epc.agent.WrapUpTime = task.WrapUpTime;
            epc.agent.CompleteTime = task.CompleteTime;

            // Finally record the interruption count
            epc.agent.InterruptionCount = task.InterruptionCount;

            upstream.Logger.debug('InteractionCapture', 'CreatedTime TimeStamp "{0}"', task.CreatedTime);
            upstream.Logger.debug('InteractionCapture', 'EpcStartTime TimeStamp "{0}"', epcStartTime);
            upstream.Logger.debug('InteractionCapture', 'Present TimeStamp "{0}"', task.PresentingTime);
            upstream.Logger.debug('InteractionCapture', 'AcceptTime TimeStamp "{0}"', task.AcceptTime);
            upstream.Logger.debug('InteractionCapture', 'WrapUpTime TimeStamp "{0}"', task.WrapUpTime);
            upstream.Logger.debug('InteractionCapture', 'CompleteTime TimeStamp "{0}"', task.CompleteTime);
            upstream.Logger.debug('InteractionCapture', 'Handle Duration "{0}"', task.HandledTime[upstream.taskservices.BaseState.Live]);
            upstream.Logger.debug('InteractionCapture', 'Total Duration "{0}"', task.Duration[upstream.taskservices.BaseState.Live]);
        }
        catch (err) {
            upstream.Logger.error('InteractionCapture', 'Error adding agent stats "{0}"', err.message);
        }

        return epc;
    },

    _logTask = function (task) {
        // logs latest browser task state. DOES not do a data look up from db before this call is made.   
        var epc = _task2Epc(task);

        var taskToSave = task;
        if (epc) {
            taskToSave.QueueTimeMs = epc.QueueTimeMs;
            taskToSave.TotalCustomerTimeMs = epc.TotalCustomerTimeMs;
            taskToSave.CreatedTime = epc.StartDateTime ? epc.StartDateTime : task.CreatedTime;
            if (epc.agent) {
                taskToSave.TalkMS = epc.agent.ActiveTimeMs ? epc.agent.ActiveTimeMs : 0;
                taskToSave.WrapMS = epc.agent.WrapupTimeMs ? epc.agent.WrapupTimeMs : 0;
                taskToSave.AlertMS = epc.agent.PresentingTimeMs ? epc.agent.PresentingTimeMs : 0;
            }
        }

        _saveCompletedTask(taskToSave);

        var url = upstream.gadget.Config.baseUri + "/api/interaction/log";

        upstream.gadgets.io.ajax({
            url: url,
            type: 'POST',
            cache: false,
            contentType: "application/json; charset=UTF-8",
            data: JSON.stringify(epc),
            xhrFields: { withCredentials: true },
            crossDomain: true,
            useMakeRequest: false,

            beforeSend: function (req) {
                req.setRequestHeader('Authorization', 'Basic ' + prefs.getString("authorization"));
            },

            success: function (data) {
                upstream.Logger.log('InteractionCapture', 'Logged epc successfully');
                _deleteTask(task);
                if (task) {
                    task.CRMTriggerAction = "aftercomplete";
                    _sendDataForCRMPOP(task);
                }
            },

            error: function (jqXHR, textStatus, errorThrown) {
                upstream.Logger.error('InteractionCapture', 'Received: {0}, when logging epc', textStatus);

                _deleteTask(task);
            }
        });
    },
     _deleteTask = function (task) {

         upstream.gadgets.io.ajax({
             url: task.CompleteLink + "?epcId=" + task.getEpcId() + "&agentId=" + task.getAgentInteractionId(),
             type: 'DELETE',
             cache: false,
             dataType: 'json',
             crossDomain: true,

             success: function (data) {
                 upstream.Logger.debug('InteractionCapture', 'task deleted');
             },

             error: function (jqXHR, textStatus, errorThrown) {
                 upstream.Logger.log('InteractionCapture', 'Error returned from server at Delete Task ' + textStatus);

             }
         });




     },
    _saveCompletedTask = function (task) {

        var channelType = task.getChannelType();
        //don't save task in completedTasks table if it is a phone call
        if (channelType === upstream.taskservices.ChannelType.Inbound || channelType === upstream.taskservices.ChannelType.Outbound) {
            return;
        }

        if (!task || !task.TaskData) {
            upstream.Logger.debug('InteractionCapture', 'saveCompletedTask failed: TaskData is null or undefined');
            return;
        }

        var url = upstream.gadget.Config.baseUri + "/api/task/saveCompletedTask";

        var completedTask = {};
        completedTask.TaskId = task.getId();
        if (task.TaskData.AgentId)
            completedTask.AgentId = task.TaskData.AgentId;
        else if (prefs)
            completedTask.AgentId = prefs.getString("id");


        if (!completedTask.AgentId) {
            upstream.Logger.debug('InteractionCapture', 'saveCompletedTask failed: AgentId is null or undefined');
            return;
        }

        completedTask.AllocatedSkillId = task.TaskData.AllocatedSkill;
        completedTask.SLASkillId = task.TaskData.ServiceLevelIndicator;
        completedTask.StartTimeStamp = task.CreatedTime;
        completedTask.CompletedTimeStamp = task.CompleteTime;
        completedTask.PresentedTimeStamp = task.PresentingTime ? task.PresentingTime : task.CreatedTime;
        completedTask.AcceptedTimeStamp = task.AcceptTime ? task.AcceptTime : task.CreatedTime;
        completedTask.QueueTimeMs = task.QueueTimeMs;
        completedTask.TotalCustomerTimeMs = task.TotalCustomerTimeMs;
        completedTask.ExpectedHandleByTime = task.TaskData.ExpectedHandleByTime ? _dateFromString(task.TaskData.ExpectedHandleByTime) : null;
        completedTask.CriticalSLATime = task.TaskData.CriticalSLATime ? _dateFromString(task.TaskData.CriticalSLATime) : null;
        completedTask.HandleTime = task.AlertMS + task.TalkMS + task.WrapMS;
        completedTask.ChannelId = channelType;
        completedTask.SubChannelId = task.getChannelSubType();

        if (completedTask.TaskId) {
            upstream.gadgets.io.ajax({
                url: url,
                type: 'POST',
                cache: false,
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify(completedTask),
                xhrFields: { withCredentials: true },
                crossDomain: true,
                success: function (data, status, xhr) {
                    if (status)
                        upstream.Logger.log('InteractionCapture', 'saveCompletedTask completed with {0}', status);
                },

                error: function (jqXHR, textStatus, errorThrown) {

                    upstream.Logger.error('InteractionCapture', 'Received: {0}, when saveCompletedTask', errorThrown + ' ' + textStatus);
                }
            });
        }
        else {
            upstream.Logger.error('InteractionCapture', 'no taskId for saveCompletedTask');
        }

    },

    _copySelectTaskData = function (fromTaskData, toTaskData) {
        try {
            // Go through all the values in the new TaskData and see if any are already set in the task
            for (var property in fromTaskData) {
                if (fromTaskData.hasOwnProperty(property)) {
                    if ((property.length > 12) && String(property).substr(0, 13).toLowerCase() == "user.microapp") {
                        continue;
                    }
                    toTaskData[property] = fromTaskData[property];
                }
            }
        } catch (err) {
            upstream.Logger.error('InteractionCapture', 'error processing data, {0}', err.message);
        }
    },

    _getInteractionData = function ($interactionTab) {
        var $interactionFields = $interactionTab.find('[name]');
        if ($interactionFields.length) {
            try {
                var interaction = {};
                interaction.SubInteractionId = parseInt($interactionTab.attr('data-sub-id'));
                interaction.viewModelId = $interactionTab.find('[data-viewmodel-id]:selected').last().data('viewmodel-id') || "";

                if (!$interactionTab.hasClass("hidden")) {
                    interaction.ActiveTab = true;
                } else {
                    interaction.ActiveTab = false;
                }

                $.each($interactionFields, function (index, control) {
                    var value = $(control).is(":checkbox") ? $(control).prop('checked') : $(control).val();
                    switch (control.tagName) {
                        case "SELECT":
                            if (!isNaN(value)) {
                                interaction[control.id] = parseInt(value);
                            }
                            break;
                        case "TEXTAREA":
                            if (value !== undefined) {
                                interaction[control.name] = value;
                            }
                            break;
                        default:
                            if (value !== undefined) {
                                interaction[control.id] = value;
                            }
                            break;
                    }
                });

                return interaction;
            } catch (err) {
                upstream.Logger.error('InteractionCapture', 'Error with _getInteractionData "{0}"', err.message);
            }
        }
    },

    _getTaskDataFromUI = function (task, getNewObject) {
        if (task) {
            var $task, $contactAreaFields, $contactFields, $interactionArea, $interactionAreaTabs, $interactionFields;
            var taskId = task.Id, taskData = getNewObject === true ? {} : task.TaskData, fieldValue;

            if (getNewObject === true) {
                _copySelectTaskData(task.TaskData, taskData);
            }

            if (taskId)
                $task = $('#task-area > #' + taskId);

            if ($task) {
                // contact area
                $contactAreaFields = $task.find('.task-contact-area').children();
                $contactFields = $contactAreaFields.find('[name]');

                $.each($contactFields, function (idx, value) {
                    if ($(value).is(":checkbox")) {
                        fieldValue = $(value).prop('checked');
                    } else {
                        fieldValue = $(value).val();
                    }
                    if (value.tagName === 'SELECT') {
                        if (!isNaN(fieldValue)) {
                            taskData[value.id] = Number(fieldValue);
                        }
                    } else {
                        if (fieldValue != undefined) {
                            taskData[value.id] = fieldValue;
                        }
                    }
                });

                // interaction area
                $interactionArea = $task.find('.task-reason-tab-area');
                $interactionAreaTabs = $interactionArea.find('div[data-sub-id]');

                $.each($interactionAreaTabs, function (idx, value) {
                    var interaction = _getInteractionData($(value));
                    if (!interaction) return;

                    taskData['interaction' + idx] = JSON.stringify(interaction);
                });
            }
        }

        return taskData;
    },

    _autoSaveTask = function (task, triggerAction) {
        if (task === null)
            return;

        // this should be converted to a 'mixin' of epc and others at some point
        var $task, taskId = task.Id, $quickTypeFields, quickTypes = {};

        var savObj = {};

        savObj = _getTaskDataFromUI(task, true);

        if (savObj) {
            $task = $('#task-area > #' + taskId);
            savObj.viewModelId = $task.find('[data-viewmodel-id]:selected').data('viewmodel-id') || "";
            $quickTypeFields = $task.find('.task-quick-type-fields').children();
            $.each($quickTypeFields, function (idx, value) {
                quickTypes[idx] = $(value).val();
            });

            savObj.QuickType = JSON.stringify(quickTypes);

            // Save the task timers (all this stuff should really be saved outside of IC)         

            //PresentingTime
            if (task.PresentingTime)
                savObj.PresentingTime = task.PresentingTime;
            else if (task.TaskData && task.TaskData.PresentingTime)
                savObj.PresentingTime = _dateFromString(task.TaskData.PresentingTime);

            //AcceptTime
            if (task.AcceptTime)
                savObj.AcceptTime = task.AcceptTime;
            else if (task.TaskData && task.TaskData.AcceptTime)
                savObj.AcceptTime = _dateFromString(task.TaskData.AcceptTime);

            //WrapUpTime
            if (task.WrapUpTime)
                savObj.WrapUpTime = task.WrapUpTime;
            else if (task.TaskData && task.TaskData.WrapUpTime)
                savObj.WrapUpTime = _dateFromString(task.TaskData.WrapUpTime);

            //CompleteTime
            if (task.CompleteTime)
                savObj.CompleteTime = task.CompleteTime;
            else if (task.TaskData && task.TaskData.CompleteTime)
                savObj.CompleteTime = _dateFromString(task.TaskData.CompleteTime);

            //DisconnectTime
            if (task.DisconnectTime)
                savObj.DisconnectTime = task.DisconnectTime;
            else if (task.TaskData && task.TaskData.DisconnectTime)
                savObj.DisconnectTime = _dateFromString(task.TaskData.DisconnectTime);

            if (task.InterruptionCount)
                savObj.InterruptionCount = task.InterruptionCount;

            //save additional values
            if (task.TaskData) {
                if (task.TaskData.AdditionalValue1)
                    savObj.AdditionalValue1 = task.TaskData.AdditionalValue1;
                if (task.TaskData.AdditionalValue2)
                    savObj.AdditionalValue2 = task.TaskData.AdditionalValue2;
                if (task.TaskData.AdditionalValue3)
                    savObj.AdditionalValue3 = task.TaskData.AdditionalValue3;
            }

            // before saving data, make sure that it has changed from the last change set
            // to avoid a unless roundtrip               
            var autoSaveString = JSON.stringify(savObj).toLowerCase();
            if (autoSaveString !== _lastAutoSaveString) {
                _lastAutoSaveString = autoSaveString;
                // update these values 
                savObj.HandledTime = JSON.stringify(task.HandledTime);
                savObj.Duration = JSON.stringify(task.Duration);

                // IsValid should only be set on inital creation or by the outlier update to task data
                delete savObj.IsValid;

                // need to replace with interaction api.
                var url = upstream.gadget.Config.baseUri + "/api/task/updatetaskdata?id=" + taskId;

                upstream.gadgets.io.ajax({
                    url: url,
                    type: 'POST',
                    cache: false,
                    contentType: "application/json; charset=UTF-8",
                    data: JSON.stringify(savObj),
                    xhrFields: { withCredentials: true },
                    crossDomain: true,
                    useMakeRequest: false,

                    beforeSend: function (req) {
                        req.setRequestHeader('Authorization', 'Basic ' + prefs.getString("authorization"));
                    },

                    success: function (data) {
                        upstream.Logger.log('InteractionCapture', 'Updated taskdata successfully');
                        upstream.Logger.debug('InteractionCapture', '_autosave happened with data "{0}" triggered by "{1}" ', autoSaveString, triggerAction);

                        // update stored interactions
                        _interactions[task.Id] = {
                            contact: JSON.parse(JSON.stringify(task.TaskData))  // cloning a copy of task data after successfully saved
                        }
                    },

                    error: function (jqXHR, textStatus, errorThrown) {
                        _lastAutoSaveString = null;
                        upstream.Logger.error('InteractionCapture', 'Received: {0}, when updating taskdata "{1}"', textStatus, errorThrown ? errorThrown.message : "");
                    }
                });
            }
        }
    },

    _completeTask = function (task) {
        clearInterval(_timeIntervalEventID);
        _sendDataForCRMPOP(task);
        _logTask(task);
    },

    _removeTask = function (taskId) {
        // find the task in the area and kill it.
        $('#task-area > #' + taskId).remove();
    },

    _taskCompleting = function (notify) {
        var task = notify.task;
        if (!task) return true;
        var taskId = task.Id;
        upstream.Logger.debug('InteractionCapture', '_taskCompleting for {0} {1}', taskId, _activeTaskId);
        // validate the form
        var ret = validateForm($('#' + taskId));

        if (ret === false) {
            task.AutoCompleted = false;
            var data = {
                task: task,
                errorType: 'VALIDATION_ERROR',
                errorMsg: ''
            };
            _hub.publish('com.upstreamworks.tasks.taskError', data);
        }

        return ret;
    },

    /// event can be one of (start, stop, end)
    _logTime = function (event, epcId) {
        upstream.Logger.debug('InteractionCapture', "_timeLogger - {0}:{1}", event, epcId);
    },
    _sendDataForCRMPOP = function (task) {
        //publish the task data changed event on an action trigger from task bar to send the latest IC data for CRM POP 
        var triggerAction = task.CRMTriggerAction;
        if (triggerAction) {
            if (task.TaskData) {
                var $taskData = _getTaskDataFromUI(task);
                if ($taskData) {
                    upstream.Logger.debug('InteractionCapture', '_sendDataForCRMPOP: Replacing TaskData');
                    task.TaskData = $taskData;
                }
                _hub.publish('com.upstreamworks.events.sendDataForCRMPOP', task);
            }

        }
    },
    _processActiveTaskChanged = function (notify) {
        var $taskArea,
            task = notify.task;

        upstream.Logger.debug('InteractionCapture', '_activeTaskChanged "{0}"', task ? task.Id : "No Task");
        if (task === null || task.Id === null) {
            if (_activeTask) {
                //trigger the task data changed event on parking of a task to send the latest IC data for CRM POP(only for manual park) 
                if (_activeTask.Status === 'PARKED' && _activeTask.AgentDetails) {
                    var $crmObj = _activeTask;
                    if (_activeTaskId && !$crmObj.Id)
                        $crmObj.Id = _activeTaskId;
                    $crmObj.CRMTriggerAction = "park";
                    _sendDataForCRMPOP($crmObj);

                }
                // inactive a task (park / done)
                // TODO: log handle time for inactive task.  Also log start time here if not logging at state change handler
                _logTime("stop", _activeTask.getEpcId());

                _triggerAddressValueChange(null);

            }

            // hide all tasks.
            $('#task-area').children().each(function (idx, value) {
                $(value).addClass('hidden');
            });

            _activeTaskId = null;
            _activeTask = null;
            _adjustHeight();
            return;
        }

        // active a task (switch / create)
        // TODO: log start time here if not logging at state change handler, otherwise no logging required here
        _logTime("start", task.getEpcId());

        // check if the task area exists.
        $taskArea = $('#task-area > #' + task.Id);

        // if not create the task area....
        if (!$taskArea.length) {
            try {
                _activeTaskId = task.Id;
                _activeTask = task;

                $taskArea = _createNewInteraction(task);
                _autoSaveTask(task, '_createNewInteraction');
            } catch (err) {
                upstream.Logger.error('InteractionCapture', 'Error thrown by _createNewInteraction "{0}"', err.message);
            }
        } else {
            
            if (upstream.gadget.Config.enableQuickType != "false") {

                // Clear the current context menu
                upstream.modules.ClipboardMenu.clear();

                var $child = $taskArea.find('.task-quick-type-field');

                if ($child.length) {
                    $child.each(function (idx, val) {
                        var testVal = $(val).val();
                        upstream.modules.ClipboardMenu.add(testVal);
                    });
                }

                var clipboard = upstream.modules.ClipboardMenu.get();
                if (clipboard == "" || clipboard == [] || clipboard == null) {
                    var temp = [];
                    _hub.publish('com.upstreamworks.events.quicktype', temp);
                }
                else {
                    _hub.publish('com.upstreamworks.events.quicktype', clipboard);
                }
            }

            if (task && task.Status != "PARKED") {
                var $contactArea = $taskArea.find('.task-contact-area');
                _triggerAddressValueChange($contactArea);
            }

        }

        // show the task area.
        if ($taskArea.length) {
            // hide all tasks.
            $('#task-area').children().each(function (idx, value) {
                $(value).addClass('hidden');
            });

            $taskArea.removeClass('hidden');
            _adjustHeight();

            _activeTaskId = task.Id;
            _activeTask = task;
        }

    },
    _dateFromString = function (str) {
        var d = new Date();
        //yyyy-mm-dd
        if (str) {
            if (typeof str === "string") {
                str = str.split(/\D+/);
                str[1] -= 1;
                try {
                    var hours = 0, mins = 0, secs = 0, msecs = 0;
                    if (str[3])
                        hours = str[3];
                    if (str[4])
                        mins = str[4];
                    if (str[5])
                        secs = str[5];
                    if (str[6])
                        msecs = str[6];

                    if (secs && msecs > 0)
                        secs = Math.round(secs + "." + msecs);


                    d.setHours(hours, mins, secs, 0);
                    d.setFullYear.apply(d, str);

                }
                catch (er) {
                    return 'Bad date-' + str;
                }
            }
            else
                return str;
        }

        var offset = d.getTimezoneOffset() / 60;
        hours = d.getHours();
        d.setHours(hours - offset)
        return d;

    },

    // The standard javascript escape() function does *not* escape the plus sign!
    _fixEscape = function (str) {
        return escape(str).replace("+", "%2B");
    },

    _createNewInteraction = function (task) {
        var $newTaskArea, $quickTypeFields, $contactArea, $contactControlArea, $subInteractionArea, $interactionArea;

        upstream.Logger.debug('InteractionCapture', '_createNewInteraction TaskId:"{0}"', task ? task.Id : "null");

        // Restore the task timers, etc. (this needs to be moved out of IC at some point)
        if (task && task.TaskData) {
            if (task.TaskData.HandledTime) {
                // Restore saved value (convert from string to number)
                task.HandledTime = JSON.parse(task.TaskData.HandledTime);
            }
            if (task.TaskData.Duration) {
                // Restore saved value (convert from string to number)
                task.Duration = JSON.parse(task.TaskData.Duration);
            }
            if (task.TaskData.EpcStartTime) {
                // Restore saved value (convert from string to Date())
                task.EpcStartTime = _dateFromString(task.TaskData.EpcStartTime);
            }
            if (task.TaskData.PresentingTime) {
                // Restore saved value (convert from string to Date())
                task.PresentingTime = _dateFromString(task.TaskData.PresentingTime);
            }
            if (task.TaskData.AcceptTime) {
                // Restore saved value (convert from string to Date())
                task.AcceptTime = _dateFromString(task.TaskData.AcceptTime);
            }
            if (task.TaskData.WrapUpTime) {
                // Restore saved value (convert from string to Date())
                task.WrapUpTime = _dateFromString(task.TaskData.WrapUpTime);
            }
            if (task.TaskData.CompleteTime) {
                // For completeness only (so they are all done together)
                // Restore saved value (convert from string to Date())
                task.CompleteTime = _dateFromString(task.TaskData.CompleteTime);
            }

            if (task.TaskData.InterruptionCount) {
                // Restore saved value (convert from string to number)
                task.InterruptionCount = task.TaskData.InterruptionCount - 0;
            }
        }

        $newTaskArea = $('#task-template').children().clone();

        // this may look odd to some...but the jquery functions
        // generally always return an object, but it may not have any
        // DOM nodes, which is what we're interested in here.
        if ($newTaskArea.length) {
            // set the id for the new area.
            $newTaskArea.attr('id', task.Id);
            $('#task-area').append($newTaskArea);

            if (_timeIntervalEventID) {
                clearInterval(_timeIntervalEventID);
            }
            _timeIntervalEventID = setInterval(
                function () { _autoSaveTask(_activeTask, 'timer'); }
                , _getTimeIntervalConfigAutoSave()
            );

            if (upstream.gadget.Config.enableQuickType != "false") {

                $('.task-quick-type-area').removeClass('hidden');

                $quickTypeFields = $newTaskArea.find('.task-quick-type-fields');

                if ($quickTypeFields) {
                    _createQuickTypeArea($quickTypeFields, task);
                }
                // add a handler for on quick type lose focus
                $quickTypeFields.on("inactive", function (e) {
                    _autoSaveTask(_activeTask, 'inactive');

                    clearInterval(_timeIntervalEventID);
                    _timeIntervalEventID = setInterval(
                        function () {
                            _autoSaveTask(_activeTask, 'quickTypeInactive');
                        },
                        _getTimeIntervalConfigAutoSave()
                    );
                });
            }            
            else {
                $('.task-quick-type-area').addClass('hidden');
                _adjustHeight();
            }

            $contactArea = $newTaskArea.find('.task-contact-area');
            $contactControlArea = $contactArea.find('.task-control-area');

            if ($contactArea) {
                _interactions[task.Id] = { contact: {} };
                // create and populate with task data info
                _createContactArea($contactArea, $contactControlArea, task);

                // Create click handler for all buttons in this area.
                // This will get fired for every instance of buttons.
                // We use visibility to determine the active instance
                // then send the pubsub message to search.

                //Overflow box for labels that have long messages
                $newTaskArea.delegate('label', 'mouseenter', function (event) {
                    var $this = $(this);

                    if (this.offsetWidth < this.scrollWidth && !$this.attr('title')) {
                        var $info = $newTaskArea.find('#infoMessage');

                        if (event.target.cellIndex && event.target.cellIndex > 1) return;

                        var temp = $this.text();

                        var inners = '<div class="item-value">' + temp + '</div>';
                        $info.css('display', 'block');
                        $info.html(inners);
                        var winHeight = $(window).height();
                        var popHeight = $info.height();
                        var targetHeight = $this.height();

                        var left = $this.offsetLeft;

                        var position = $this.offset();

                        if (position.top + popHeight > winHeight) {
                            position.top = position.top - popHeight;
                        } else {
                            position.top = position.top + targetHeight;
                        }
                        $info.offset(position);
                    }
                });
                //Remove overflow box regardless if visible or not
                $newTaskArea.delegate('label', 'mouseleave', function () {
                    var $info = $newTaskArea.find('#infoMessage');
                    $info.css('display', 'none');
                    $info.html('');
                });

                $interactionArea = $newTaskArea.find('.task-reason-tab-area');
                //$interactionAreaTabs = $interactionArea.find('div[data-sub-id]');

                $('#task-area').delegate('.history-btn', 'click', function () {
                    if (($contactArea).is(':visible')) {
                        var $contactId = $contactArea.find('[data-uptakeprop="CNTCTID"]');
                        var $secondaryContactID = $interactionArea ? $interactionArea.find('[data-destination-column="SecondaryContactId"]:visible') : '';
                        var $srcAddr = $contactArea.find('[data-uptakeprop="SRCADDR"]');
                        var $destAddr = $contactArea.find('#DestinationAddress');

                        var $doSourceAddressSearch = true, secondarySearchBy = "none", customerAddress, $data;
                        var $channel = $('#channels').find('option[value=' + task.getChannelSubType() + ']');
                        if ($channel.length > 0) {

                            var srcAddrSearch = $channel.data('source-address-search');
                            if (srcAddrSearch && (srcAddrSearch === "False"))
                                $doSourceAddressSearch = false;

                            if ($channel.data('secondary-search'))
                                secondarySearchBy = $channel.data('secondary-search');
                        }

                        var $doDestinationAddressSearch = false;
                        if (task.getChannelType() === upstream.taskservices.ChannelType.Outbound) {
                            $doDestinationAddressSearch = true;
                            $doSourceAddressSearch = false;
                        }

                        upstream.Logger.debug('InteractionCapture', 'doSourceAddressSearch: {0}', $doSourceAddressSearch);
                        upstream.Logger.debug('InteractionCapture', 'doDestinationAddressSearch: {0}', $doDestinationAddressSearch);

                        var debugMsg = '';
                        if (($contactId.length) && ($contactId.val() != '') || ($secondaryContactID.length) && ($secondaryContactID.val() != '')) {
                            if ($contactId.length && $contactId.val() != '' && $secondaryContactID.length && $secondaryContactID.val() != '') {
                                debugMsg='Searching by ContactId=' +$contactId.val() +' AND SecondaryContactID='+$secondaryContactID.val();
                                $data = "ContactId=" + encodeURIComponent($contactId.val()) + "&SecondContactID=" + encodeURIComponent($secondaryContactID.val());
                            }
                            else {
                                if ($contactId.length && $contactId.val() != '') {
                                    debugMsg = 'Searching by ContactId=' + $contactId.val() + ' OR SecondaryContactID=' + $contactId.val();                                   
                                    $data = "ContactId=" + encodeURIComponent($contactId.val());
                                }
                                else if ($secondaryContactID.length && $secondaryContactID.val() != '') {
                                    debugMsg = 'Searching by ContactId=' + $secondaryContactID.val() + ' OR SecondaryContactID=' + $secondaryContactID.val();                                 
                                    $data = "ContactId=" + encodeURIComponent($secondaryContactID.val());
                                }
                            }
                        }


                        if ($doSourceAddressSearch && ($srcAddr.length) && ($srcAddr.val() != '')) {
                            customerAddress = _fixEscape($srcAddr.val());
                            if ($data) {
                                upstream.Logger.debug('InteractionCapture', 'Searching by ContactId/SecondaryContactId or SourceAddress');
                                $data+= "&SourceAddress=" + customerAddress;
                            }
                            else {
                                upstream.Logger.debug('InteractionCapture', 'Searching by SourceAddress "{0}"', customerAddress);
                                $data = "SourceAddress=" + customerAddress;
                            }
                            if ($data)
                                _hub.publish("com.upstreamworks.tasks.search", $data + "&SecondarySearch=" + secondarySearchBy);
                        }
                        else if ($doDestinationAddressSearch && ($destAddr.length) && ($destAddr.val() != '')) {
                            customerAddress = _fixEscape($destAddr.val());                          
                            if ($data) {
                                upstream.Logger.debug('InteractionCapture', 'Searching by ContactId/SecondaryContactId or DestinationAddress');
                                $data += "&DestinationAddress=" + customerAddress;
                            }
                            else {
                                upstream.Logger.debug('InteractionCapture', 'Searching by DestinationAddress "{0}"', customerAddress);
                                $data = "DestinationAddress=" + customerAddress;
                            }
                            if ($data)
                                _hub.publish("com.upstreamworks.tasks.search", $data + "&SecondarySearch=" + secondarySearchBy);
                        }
                        else if ($data) {                            
                            if (debugMsg != '')
                                upstream.Logger.debug('InteractionCapture', debugMsg);
                            _hub.publish("com.upstreamworks.tasks.search", $data + "&SecondarySearch=" + secondarySearchBy);
                        }
                        else {
                            upstream.Logger.debug('InteractionCapture', 'Searching by Prompt Options');
                            _hub.publish("com.upstreamworks.tasks.search");
                        }
                    }
                });
            }

            // select the current channel before creating the tabs, this will give us the 
            // code set to use for CR codes for this channel
            if (task) {
                var $channel;
                $channel = $('#channels');
                if ($channel.length) {
                    try {
                        $channel.val(task.getChannelSubType());
                    }
                    catch (err) {
                        upstream.Logger.error('InteractionCapture', err.description);
                    }
                }


            }

            // Restore the sub-interactions
            _createInteractionArea($newTaskArea, task);

            $contactArea.add($subInteractionArea).on("inactive", function (e) {
                _autoSaveTask(_activeTask, '_createNewInteractionInactive');
            });
        }
        return $newTaskArea;
    },
    _initializeSubInteractionArea = function (tabArea, id, savedInteraction, task, override) {
        if (tabArea) {
            var $tab = tabArea.find('div[data-sub-id=' + id + ']');

            // if I have data for this tab - try to fill it in
            if ($tab && $tab.length) {
                var $interactionId = $tab.find("#Id");
                if ($interactionId.length && savedInteraction && savedInteraction.ExternalId) {
                    $interactionId.val(savedInteraction.ExternalId);
                }

                var $mainSelector = $tab.find("#ContactReason");

                if ($mainSelector.length) {
                    if (savedInteraction && savedInteraction.ContactReason) {
                        // Only update if not already set
                        if (($mainSelector.val() === undefined) || ($mainSelector.val() === "default" || override)) {
                            var reasonCode = _checkForCustomCode($mainSelector, "ContactReason", savedInteraction.ContactReason, task.TaskData.DefaultContactReason);
                            if (reasonCode) {
                                // if I have a contact reason (and it exists in the list) for this interaction -> select it
                                $mainSelector.val(reasonCode);
                            }
                        }
                    }

                    var $selected = $mainSelector.children(":selected");
                    if ($selected && $selected.attr("default") !== "true") {
                        // create the template fields based on the contact type selection
                        _createReasonTemplate($mainSelector, $tab);

                        var $secondarySelector = $tab.find("#ContactReasonDetail");
                        if ($secondarySelector.length) {
                            var detailCode;
                            if (savedInteraction && savedInteraction.ContactReasonDetail) {
                                // Only update if not already set
                                if (($secondarySelector.val() === undefined) || $secondarySelector.val() === "default" || override) {
                                    detailCode = _checkForCustomCode($secondarySelector, "ContactReasonDetail", savedInteraction.ContactReasonDetail, task.TaskData.DefaultContactReasonDetail);
                                    if (detailCode) {
                                        $secondarySelector.val(detailCode);
                                    }
                                }
                            }
                            // create the template for the reason detail
                            _createDetailTemplate($secondarySelector, $tab);
                        }

                        // populate the field data from task data
                        _populateViewModel($tab, savedInteraction, override);
                    }
                }
            }
        }
    },

    _createQuickTypeArea = function ($quickTypeArea, task) {
        var i;

        for (i = 0; i < 6; i++) {
            var quickTypeField = document.createElement("input");

            quickTypeField.setAttribute("type", "text");
            quickTypeField.setAttribute("class", "task-quick-type-field span2");
            quickTypeField.setAttribute("spellcheck", "false");
            quickTypeField.setAttribute("maxlength", "100");

            $quickTypeArea.append(quickTypeField);
        }

        // populate the fields with the task data if there
        if ($quickTypeArea && $quickTypeArea.length > 0 && task && task.TaskData && task.TaskData.QuickType) {
            // Restore quicktype data
            var savedQuickType = JSON.parse(task.TaskData.QuickType);
            $quickTypeArea.children().each(function (idx, val) {
                $(val).val(savedQuickType[idx]);
                var testVal = $(val).val();
                upstream.modules.ClipboardMenu.add(savedQuickType[idx]);
            });
        }
    },

    // This function will check if a value being set for a selector matches a custom code defined for the selector.
    // If so it will return the proper value that corresponds to the custom code, otherwise it will return the original value.
    // If an error is detected it will return the value "default".
    _checkForCustomCode = function ($selector, selectorName, testValue, defaultValue) {
        var returnValue = testValue;    // Ensure we return something

        upstream.Logger.debug('InteractionCapture', '_checkForCustomCode: called with selectorName: "{0}" testValue: "{1}"', selectorName, testValue);

        // If we have a selector type field (combo box) check if we need to "fix" a possible custom code first
        // Custom Code values must have a leader of "CC="
        if ($selector.is("select")) {
            // Check if a custom code is being specified
            if ((typeof (testValue) == 'string') && (testValue.length > 3) && (testValue.substring(0, 3) === "CC=")) {
                var customCode = testValue.substring(3);
                var defaultCustomCode = null;
                if ((typeof (defaultValue) == 'string') && (defaultValue.length > 3) && (defaultValue.substring(0, 3) === "CC=")) {
                    defaultCustomCode = defaultValue.substring(3);
                }

                // See if we have a custom code value that matches
                if ($selector.find("option[data-custom-code='" + customCode + "']").length) {
                    // If a custom code use the actual value for the option
                    returnValue = $selector.find("option[data-custom-code='" + customCode + "']").val();
                    upstream.Logger.debug('InteractionCapture', '_checkForCustomCode: "{0}" customCode "{1}" swapped to "{2}"', selectorName, customCode, returnValue);
                }
                else if ((defaultCustomCode !== null) && ($selector.find("option[data-custom-code='" + defaultCustomCode + "']").length)) {
                    returnValue = $selector.find("option[data-custom-code='" + defaultCustomCode + "']").val();
                    upstream.Logger.debug('InteractionCapture', '_checkForCustomCode: "{0}" defaultCustomCode "{1}" swapped to "{2}"', selectorName, defaultCustomCode, returnValue);
                }
                else {
                    // Log an error if no possible value found
                    upstream.Logger.error('InteractionCapture', '_checkForCustomCode: "{0}" customCode "{1}" not valid!', selectorName, customCode);
                    returnValue = "default";
                }
            }

            // Make sure we have a valid value otherwise use default
            if ($selector.find("option[value='" + returnValue + "']").length === 0) {
                upstream.Logger.error('InteractionCapture', '_checkForCustomCode: "{0}" fieldValue "{1}" not valid!', selectorName, returnValue);
                returnValue = "default";
            }
        }
        return returnValue;
    },

    _createContactArea = function ($contactArea, $contactControlArea, task) {
        var $contactSelector, $contactTemplateArea, $contactTemplate, $templateValue, property;

        if ($contactControlArea) {
            $contactTemplate = $('#viewModels > #CONTACT').children().clone();
            $contactControlArea.append($contactTemplate);

            // if I have a contact type code in task data -> select it and 
            // display the view model fields for the selection
            if (task && task.TaskData && task.TaskData.ContactType) {
                $contactSelector = $contactArea.find("#ContactType");

                if ($contactSelector.length) {
                    // Only update if not already set
                    if (($contactSelector.val() == undefined) || ($contactSelector.val() == "default")) {
                        upstream.Logger.debug('InteractionCapture', '_createContactArea Contact selector not set yet');

                        var contactType = _checkForCustomCode($contactSelector, "ContactType", task.TaskData.ContactType, task.TaskData.DefaultContactType);
                        // if I have a contact type in task data -> select it
                        $contactSelector.val(contactType);

                        // create the template fields based on the contact type selection
                        _createContactTemplate($contactArea, $contactSelector);
                    }
                    else {
                        upstream.Logger.debug('InteractionCapture', 'Contact selector already set');
                    }

                    // populate the field data from task data
                    _populateViewModel($contactArea, task.TaskData);

                    if (task && task.Status != "PARKED")
                        _triggerAddressValueChange($contactArea);
                }
            }
        }
    },

    _createContactTemplate = function ($contactArea, $contactSelector) {
        var $template, $templateOverflow;

        $template = $contactArea.find('.template-control-area');
        $templateOverflow = $contactArea.find('.task-template-overflow-area');

        if ($contactSelector) {
            // show the selector fields
            _showContactViewModel($contactSelector.children(":selected"), $template, $templateOverflow);
        }
    },

    _createReasonTemplate = function ($selector, $tabArea) {
        var templateArea, templateOverflowArea, detailArea, taskNotes;
        templateArea = $tabArea.find('.template-control-area');
        templateOverflowArea = $tabArea.find('.task-template-overflow-area');
        detailArea = $tabArea.find('[data-field-type=secondaryselector]');
        taskNotes = $tabArea.find('.task-notes-area');

        if ($selector) {
            // show the selector fields
            _showReasonViewModel($selector.children(":selected"), templateArea, templateOverflowArea, detailArea, taskNotes);
        }
    },

    _createDetailTemplate = function ($selector, $tabArea) {
        var templateArea, templateOverflowArea, taskNotes;

        templateArea = $tabArea.find('.template-control-area');
        templateOverflowArea = $tabArea.find('.task-template-overflow-area');
        taskNotes = $tabArea.find('.task-notes-area');
        if ($selector) {
            // show the selector fields
            _showDetailViewModel($selector.children(":selected"), templateArea, templateOverflowArea, taskNotes);
        }
    },

    _showContactViewModel = function ($selectorElement, $template, $templateOverflow) {
        var viewModel = $selectorElement.data('viewmodel-id');
        if (viewModel) {
            var cloned = $('#viewModels > #' + viewModel).children().clone();

            // I can only show 4 detail fields after the main selector
            _populateTemplate(cloned, $template, $templateOverflow, 4);

            $template.find('div > input[data-mask]').each(function (idx, value) {
                $(value).mask($(value).attr('data-mask'));
            });

            $templateOverflow.find('input[data-mask]').each(function (idx, value) {
                $(value).mask($(value).attr('data-mask'));
            });
        } else {
            _clearFields($template, $templateOverflow);
        }
    },

    _showReasonViewModel = function ($selectorElement, templateArea, templateOverflowArea, detailArea, taskNotes) {
        var viewModel = $selectorElement.data('viewmodel-id');
        var codeSetId = $selectorElement.data('codeset-id');
        taskNotes.removeClass('hidden');
        if (viewModel) {
            var cloned = $('#viewModels > #' + viewModel).children().clone();

            // if the main selector has a view model I can show 4 fields after the selector
            _populateTemplate(cloned, templateArea, templateOverflowArea, 4);

            templateArea.find('div > input[data-mask]').each(function (idx, value) {
                $(value).mask($(value).attr('data-mask'));
            });

            templateOverflowArea.find('div > input[data-mask]').each(function (idx, value) {
                $(value).mask($(value).attr('data-mask'));
            });


            //If Reason Detail does not exist for Reason type. 
            if (codeSetId == null) {
                //It cant be required(since it doenst have options)
                var $requiredChildren = detailArea.children(".required");
                if ($requiredChildren) {
                    //Was required to reapply required tag when one with option sets is selected
                    $requiredChildren.addClass("wasRequired");
                    $requiredChildren.removeClass("required");
                    //remove error for good measure
                    $requiredChildren.removeClass("error");
                }
                //Won't validation if errorMessage is there
                var $errorChild = detailArea.children(".errorMessage");
                if ($errorChild) {
                    $errorChild.removeClass("errorMessage");
                }

            }
            _adjustHeight();
        } else if (codeSetId) {

            var detailSelector = $('#codeSets > #' + codeSetId + ' > select').children().clone();
            detailArea.removeClass('hidden');

            //.wasRequired added to be able to remove/apply required tags as needed 
            var $requiredChildren = detailArea.find(".mandatory, .wasRequired");
            if ($requiredChildren) {
                $requiredChildren.addClass("required");
                $requiredChildren.removeClass("wasRequired");
                $requiredChildren.removeClass("mandatory");
                $requiredChildren.removeClass("error");
            }

            var $selector = detailArea.find('select');
            var $defaultEntry = $selector.find('[default=true]').clone();

            $selector.children().remove();

            var $newSelector = $selector.clone();

            $selector.remove();

            $newSelector.append($defaultEntry);
            $newSelector.append(detailSelector);

            detailArea.append($newSelector);
            if ($defaultEntry.length === 0)
                $newSelector.trigger("change");

            _adjustHeight();
        }
        else {
            // XXX: this should not be a valid case ...              
            if (codeSetId === 0) {
                var $requiredChildren = detailArea.find(".required");
                if ($requiredChildren) {
                    $requiredChildren.removeClass("required");
                    $requiredChildren.addClass("mandatory");
                    $requiredChildren.siblings(".errorMessage").remove();

                }
            }
        }
    },

    _showDetailViewModel = function ($selectorElement, templateArea, templateOverflowArea, taskNotes) {
        var viewModel = $selectorElement.data('viewmodel-id');
        if (viewModel) {
            var cloned = $('#viewModels > #' + viewModel).children().clone();

            // for the secondary selector I only have 4 fields including the selector
            _populateTemplate(cloned, templateArea, templateOverflowArea, 3);
            taskNotes.removeClass('hidden');

            templateArea.find('div > input[data-mask]').each(function (idx, value) {
                $(value).mask($(value).attr('data-mask'));
            });

            templateOverflowArea.find('div > input[data-mask]').each(function (idx, value) {
                $(value).mask($(value).attr('data-mask'));
            });

            _adjustHeight();
        }
    },
    _triggerAddressValueChange = function (area) {
        var mapSearchField = upstream.gadget.Config.mapSearchField;
        var changes = {};
        if (area && mapSearchField) {
            var $templateField = area.find("input[name~='" + mapSearchField + "']");
            if ($templateField && $templateField.length) {
                changes[mapSearchField] = $templateField.val();
                TaskServices.notifyTaskDataChanged(_activeTask, changes, { override: true, origin: _GADGET_TAG });
            }
        }
    },

    _populateViewModel = function (area, taskData, override) {
        if (taskData) {
            var property, $templateField;

            // now spin the task data looking for matching controls/template fields
            for (property in taskData) {
                if (property !== "\"\"" && property !== "") {
                    // populate all the fields that do not have a value already
                    $templateField = area.find('#' + property);

                    if ($templateField.length) {
                        _setFieldValue($templateField, property, taskData[property], override);

                    } else { // try to find the template field by destination column
                        $templateField = area.find("[data-destination-column='" + property + "']");
                        if ($templateField.length) {
                            _setFieldValue($templateField, property, taskData[property], override);
                        }
                    }
                }
            }
        }
    },

    _setFieldValue = function ($templateField, fieldName, fieldValue, override) {

        // If we have a selector type field (combo box) check if we need to "fix" a possible custom code first
        // Custom Code values must have a leader of "CC="
        if ($templateField.is("select")) {
            fieldValue = _checkForCustomCode($templateField, fieldName, fieldValue, null);
        }

        if ($templateField.is(":checkbox")) {
            if ($templateField.attr('data-set')) {
                upstream.Logger.debug('InteractionCapture', 'FieldName: "{0}" already set', fieldName);
                return;
            }

            upstream.Logger.debug('InteractionCapture', 'Checkbox Val(): "{0}"', $templateField.val());
            upstream.Logger.debug('InteractionCapture', '_setFieldValue FieldName:"{0}", Setting: {1} -> {2}', fieldName, $templateField.prop('checked'), fieldValue);
            upstream.Logger.debug('InteractionCapture', '_setFieldValue Type: {0} -> {1}', typeof ($templateField.prop('checked')), typeof (fieldValue));

            if (typeof fieldValue === 'string') {
                var value = (fieldValue == 'True');
                upstream.Logger.debug('InteractionCapture', '_setFieldValue New value Type: {0}', typeof (value));
                $templateField.prop('checked', value);
            } else {
                $templateField.prop('checked', fieldValue);
            }
            $templateField.attr('data-set', 'set');

            upstream.Logger.debug('InteractionCapture', '_setFieldValue Now:{0}', $templateField.prop('checked'));
        } else {
            // read the value the field has set already
            var testVal = $templateField.val();
            // populate only if it's not already filled in
            if (testVal === "" || testVal === "default" || override) {
                $templateField.val(fieldValue);
                if (fieldValue && $templateField.attr('data-mask') && ($templateField.attr('data-type') === "phone10" || $templateField.attr('data-type') === "phone11")) {
                    $templateField.mask($templateField.attr('data-mask'));
                }
            }
            if (fieldName === "ContactId") {
                upstream.Logger.debug('InteractionCapture', '_setFieldValue ContactId fieldValue: "{0}" & in $templateField: "{1}"', fieldValue, $templateField.val());
            }
        }
    },

    _createSubInteractionArea = function ($subInteractionArea, tabId) {
        _addTabToSubInteraction($subInteractionArea.find('.task-reason-tab-area'), tabId);
    },

    _addTab = function (tabArea, tabHeader, tabId) {
        var $tab, tabHeaderValue;
        if (!($(tabArea).find('div[data-sub-id=' + tabId + ']').length > 0)) {
            $tab = _createTab(tabId);

            tabHeaderValue = document.createElement('li');
            if (tabId == 1) {
                $(tabHeaderValue).html('<a href="#">' + tabId + '</a>');
            } else {
                $(tabHeaderValue).html('<a href="#">' + tabId + '</a><button class="close">&times;</button>');
            }

            $(tabHeaderValue).attr('data-sub-id', tabId);
            var button = $(tabHeader).children('.addTabButtonTab');
            button.before(tabHeaderValue);

            $(tabArea).append($tab);
        }
    },

    _createTab = function (tabId) {
        var $reasonTab, $reasonArea, $reasonTemplate, reasonDetailArea, reasonTemplateArea, $detailSelectorWrapper, $commentWrapper, $reasonSelectorWrapper, $reasonSelector, $detailSelector, $defaultCodes, $channel;

        $reasonTab = $('#task-tab-template').clone();
        $reasonTab.attr('id', '');
        $reasonTab.removeClass('hidden');
        $reasonTab.attr('data-sub-id', tabId);

        $reasonArea = $reasonTab.find('.task-control-area');
        $commentWrapper = $reasonTab.find('.task-notes-area');

        // Reason is a special template.
        upstream.Logger.debug('InteractionCapture', '_createTab: creating the reason template view model');
        $reasonTemplate = $('#viewModels > #REASON').children().clone();

        $reasonSelector = $($reasonTemplate[0]);
        $detailSelector = $($reasonTemplate[1]);

        $reasonArea.append($reasonTemplate[0]);
        $reasonArea.append($reasonTemplate[1]);
        $reasonArea.append($reasonTemplate[2]);
        $commentWrapper.append($reasonTemplate[3]);

        $detailSelector.addClass('hidden');
        $commentWrapper.addClass('hidden');

        // now get the right code set for the selected channel
        $channel = $('#channels');
        var channelCodeSet = $channel.children(":selected").data('channel-codeset');
        $defaultCodes = $('#codeSets > #' + channelCodeSet).find('select').children().clone();

        $($reasonSelector.children()[1]).append($defaultCodes);
        return $reasonTab;
    },

    _addNewSubInteraction = function (tabArea, tabHeaderArea) {
        // Determine newTabId
        var $tabHeaders = tabHeaderArea.find('[data-sub-id]');

        var max = 1, count, value;


        if (!$tabHeaders.length) {
            // no tabs but the add button, add first.
            _addTabToSubInteraction(tabArea, max);
            return;
        }

        for (count = 0; count < $tabHeaders.length; count++) {
            value = Number($($tabHeaders[count]).attr('data-sub-id'));

            if (isNaN(value)) {
                upstream.Logger.error('InteractionCapture', 'bad value for data-sub-id header');
            } else if (value > max) {
                max = value;
            }
        }

        _addTabToSubInteraction(tabArea, max + 1);
        _initializeSubInteractionArea(tabArea, max + 1);
        if ($tabHeaders.length === 4) {
            tabArea.find(".addTabButtonTab").hide();
        }
    },

    _addTabToSubInteraction = function (tabArea, newTabId) {
        var tabsArea, tabHeader;
        tabHeader = tabArea.children('.task-reason-tab-header').children('ul');
        _addTab(tabArea, tabHeader, newTabId);
        _selectTab(tabArea, newTabId);
    },

    _selectTab = function (tabArea, tabId) {
        tabArea.find('div[data-sub-id]').addClass('hidden');
        tabArea.find('div[data-sub-id=' + tabId + ']').removeClass('hidden');
        tabArea.find('li[data-sub-id]').removeClass('selected');
        tabArea.find('li[data-sub-id] > a').removeClass('selected');
        tabArea.find('li[data-sub-id=' + tabId + ']').addClass('selected');
        tabArea.find('li[data-sub-id=' + tabId + ']').find('a').addClass('selected');
    },

    _adjustHeight = function () {
        gadgets.window.adjustHeight($('#task-area').height());
    },

    _clearFields = function ($templateArea, $templateOveflowArea) {
        $templateArea.children().remove();
        $templateOveflowArea.children().remove();

        _adjustHeight();
    },

    _populateTemplate = function ($template, $templateArea, $templateOverflowArea, maxFields) {
        maxFields = maxFields || 4;

        // make sure we're clear.
        _clearFields($templateArea, $templateOverflowArea);

        if ($template.length <= maxFields) {
            // simply add all the fields...
            $templateArea.append($template);
        } else {
            var count = 0;
            var visibleCount = 0;
            for (count = 0; count < $template.length; count++) {
                if (visibleCount < maxFields) {
                    $templateArea.append($template[count]);
                } else {
                    $templateOverflowArea.append($template[count]);
                }
                if ($template[count].style.display != "none") { // add visible field count only
                    visibleCount++;
                }
            }
        }

        _adjustHeight();
    },
    _createInteractionArea = function ($taskArea, task, override) {
        var $subInteractionArea = $taskArea.find('.task-sub-interaction-area');
        // Restore the sub-interactions
        if ($subInteractionArea && task) {
            var id = 1, activeTabId = 1;
            if (task.TaskData) {
                var $tabArea = $subInteractionArea.find('.task-reason-tab-area');
                var numTabs = 0;

                // Look for saved interactions (5 max)
                for (var i = 0; i < 5; i++) {
                    id = i + 1;
                    if (!task.TaskData["interaction" + i]) continue;

                    // create a tab for the subinteraction, the mainselector with its codes will be created there
                    // default selection, meaning no view model yet
                    _createSubInteractionArea($subInteractionArea, id);
                    numTabs++;
                    // if I have reached the max number of tabs hide the add button
                    if (numTabs === 5) {
                        $tabArea.find(".addTabButtonTab").hide();
                    }
                    // Restore interaction data
                    var savedInteraction = task.TaskData["interaction" + i];
                    if (savedInteraction) {
                        //convert string to JSON
                        if (typeof savedInteraction === 'string') {
                            savedInteraction = JSON.parse(savedInteraction);
                        }
                        upstream.Logger.debug('InteractionCapture', '_createNewInteraction: Found interaction: "{0}"', JSON.stringify(savedInteraction));
                        if (savedInteraction.hasOwnProperty("ActiveTab") && savedInteraction.ActiveTab) {
                            activeTabId = id;
                        }

                        _initializeSubInteractionArea($tabArea, id, savedInteraction, task, override);
                    }
                }

                // if I did not get any interaction taskdata I have to create a default tab
                if (numTabs == 0) {
                    _createSubInteractionArea($subInteractionArea, 1);

                    _initializeSubInteractionArea($tabArea, 1);

                }

                if (!activeTabId)
                    activeTabId = 1;

                var $tab = $tabArea.find('div[data-sub-id=' + activeTabId + ']');
                // after filling in all the tabs with data - select the first tab               
                if ($tab && $tab.length) {
                    _selectTab($tabArea, activeTabId);
                }
            }
            else {
                // if there is no task data we have to create the first tab as default
                _createSubInteractionArea($subInteractionArea, 1);
            }
        }

    },

    _updateTask = function (task, changedValues, options) {
        var $taskArea, $contactArea, $contactControlArea, $contactSelector, $quickTypeFields, $subInteractionArea;
        var options = options || {};
        var override = options.override;
        if (options.disableDataDip) {
            var exist = false;
            if (_disableDataDip.length == 0) _disableDataDip.push(task.Id);
            else {
                var exist = _disableDataDip.indexOf(task.Id);              
                if (exist == -1) _disableDataDip.push(task.Id);
            }
        }

        if (!task || !changedValues || options.origin === _GADGET_TAG) return;

        // Check if the task area exists.
        $taskArea = $('#task-area > #' + task.Id);

        // If not ignore the update
        if (!$taskArea.length) return;

        upstream.Logger.debug('InteractionCapture', 'Updating task');

        $contactArea = $taskArea.find('.task-contact-area');
        $contactControlArea = $contactArea.find('.task-control-area');

        if ($contactArea.length && $contactControlArea.length) {
            var contactType = task.TaskData.ContactType;
            if (changedValues.ContactType)
                contactType = changedValues.ContactType;

            if (contactType) {
                $contactSelector = $contactArea.find("#ContactType");

                if ($contactSelector.length) {
                    // Only update if not already set
                    if (override || $contactSelector.val() === undefined || $contactSelector.val() === "default") {
                        upstream.Logger.debug('InteractionCapture', '_updateTask: Contact selector not set yet');

                        // if I have a contact type in task data -> select it
                        contactType = _checkForCustomCode($contactSelector, "ContactType", contactType, task.TaskData.DefaultContactType);
                        $contactSelector.val(contactType);

                        // create the template fields based on the contact type selection
                        _createContactTemplate($contactArea, $contactSelector);
                    }
                    else {
                        upstream.Logger.debug('InteractionCapture', 'Contact selector already set');
                    }
                   
                    // populate the field data from task data
                    if (options.disableDataDip) {
                       _populateViewModel($contactArea, task.TaskData, override);
                    }
                    else {
                        if (_disableDataDip.length > 0) {
                            var exist = false;
                            for (var i = 0; i < _disableDataDip.length; i++) {
                                if (_disableDataDip[i] == task.Id)
                                {
                                    exist = true;                                  
                                }
                            }
                            if (exist) {
                                _disableDataDip.splice($.inArray(_disableDataDip[i], _disableDataDip), 1);
                            }
                            else _populateViewModel($contactArea, task.TaskData, override);
                        }
                        else _populateViewModel($contactArea, task.TaskData, override);
                    }

                    //if (task && task.Status != "PARKED")
                    //    _triggerAddressValueChange($contactArea);
                }
            }
        }

        var interactionChanged = false;
        if (changedValues) {
            for (var property in changedValues) {
                if (property.indexOf("interaction") < 0) continue;
                interactionChanged = true;
                break;
            }
        }

        if (interactionChanged) {
            _createInteractionArea($taskArea, task, override);
        }

        if (upstream.gadget.Config.enableQuickType != "false") {      
            $('.task-quick-type-area').removeClass('hidden');
       
            if (changedValues.QuickType) {
                $quickTypeFields = $taskArea.find('.task-quick-type-fields');

                if ($quickTypeFields) {
                    $quickTypeFields.children().remove();
                    _createQuickTypeArea($quickTypeFields, task);
                }
            }
        }
        else {
            $('.task-quick-type-area').addClass('hidden');
            _adjustHeight();
        }
    },

    _getTimeIntervalConfigAutoSave = function () {
        var timeInterval = upstream.gadget.Config.autoSaveTimeInterval || 10000;
        return timeInterval;
    },

    _populateCRMlnks = function () {
        var $crm_menu = $('.crm_menu');
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
                        st += "<label>" + c.Name + "</label>";
                        st += "<li><a data-crmid='" + c.Id + "' onclick=\"upstream.modules.InteractionCapture.crmPop(this);\">" + _localization.InteractionCapture.Open + " " + c.Name + "</a></li>";
                    }
                }
                $('.crm-ul').html(st);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                upstream.Logger.error("InteractionCapture", "Error retrieving CRM actions");
            }
        });

    },

    _tryLoadConfig = function () {

        if (_loadingConfig === true)
            return;

        _loadingConfig = true;

        // get the codes / views
        var url = upstream.gadget.Config.baseUri + "/api/interaction/InteractionCapture";
        url += '?host=' + _prefs.getString("host");
        var hl = _prefs.getLang();
        if (hl)
            url += '&hl=' + hl;

        upstream.gadgets.io.ajax({
            url: url,
            type: 'GET',
            cache: false,
            contentType: "text/html; charset=UTF-8",
            xhrFields: { withCredentials: true },
            crossDomain: true,
            useMakeRequest: false,
            dataType: "html",
            success: function (data) {
                clearInterval(_loadingIntervalEventID);
                upstream.Logger.debug('InteractionCapture', 'Got configuration');
                $('body').append(data);
                _loadingConfig = false;
                _finishInit();
            },

            error: function (jqXHR, textStatus, errorThrown) {
                var errormsg = 'Received: "' + textStatus + '", when getting capture codes/views';
                upstream.Logger.error('InteractionCapture', errormsg);
                _loadingConfig = false;
            }
        });
    },

    _finishInit = function () {

        try {
            if (upstream.gadget.Config.enableQuickType != "false") {
                upstream.modules.ClipboardMenu.init();
            }
        } catch (err) {
        }

        try {

            finesse.clientservices.ClientServices.init({
                host: _prefs.getString("host"),
                restHost: _prefs.getString("restHost"),
                localhostPort: _prefs.getString("localhostPort"),
                id: _prefs.getString("id"),
                authorization: _prefs.getString("authorization")
            });

            _user = new finesse.restservices.User({
                id: _prefs.getString("id")
            });
        } catch (err) {
            gadgets.Hub.publish('com.upstreamworks.alertr.alert', 'failed: ' + err.message);
        }

        // Trigger task data update everytime mouse leaves interaction capture
        $('#task-area').on('mouseleave', function () {
            _autoSaveTask(_activeTask, 'mouseleave');
        });

        $('#task-area').delegate('.clipboard-target', 'contextmenu', function (e) {       
            if (upstream.gadget.Config.enableQuickType != "false") {

                e.preventDefault();

                var that = $(this);

                upstream.modules.ClipboardMenu.show(e.pageX, e.pageY, function (data) {
                    upstream.modules.utilities.insertIntoField(that, data);

                    var $area = that.closest(".task-contact-area, div[data-sub-id]");
                    if (!$area.length) return;
                    var changes = {};
                    if ($area.is(".task-contact-area")) {
                        /// notifying field changed on contact area using quick type
                        changes[that.prop("name")] = that.val();
                        TaskServices.notifyTaskDataChanged(_activeTask, changes, { override: true, origin: _GADGET_TAG });
                    } else {
                        /// notifying field changed on interaction area using quick type
                        var interactionIndex = parseInt($area.data("sub-id")) - 1,
                            interactionKey = "interaction" + interactionIndex,
                            interactionData = _getInteractionData($area);

                        changes[interactionKey] = JSON.stringify(interactionData);
                        TaskServices.notifyTaskDataChanged(_activeTask, changes, { override: true, origin: _GADGET_TAG });
                    }
                });
            }
            else {
                return true;
            }

            return false;
        });

        $('#task-area').delegate('.task-quick-type-field', 'blur', function (e) {
            if (upstream.gadget.Config.enableQuickType != "false") {
                var that = $(this);

                try {
                    upstream.modules.ClipboardMenu.add(that.val());
                } catch (err) {
                    upstream.Logger.error('InteractionCapture', err.description);
                }

                var list = upstream.modules.ClipboardMenu.get();

                _hub.publish('com.upstreamworks.events.quicktype', list);
            }

        });

        $('#task-area').delegate('.task-contact-area :input', 'change keyup', function (e) {
            if (e.which && e.which !== 13) return;

            if (_interactions && _interactions[_activeTaskId]) {
                var interaction = _interactions[_activeTaskId];

                if (interaction.contact) {
                    var contact = interaction.contact;
                    var $target = $(e.target);
                    if (typeof contact[e.target.name] === "undefined" || contact[e.target.name] !== $target.val()) {
                        var value = $(e.target).is(":checkbox") ? e.target.checked : $target.val();
                        contact[e.target.name] = value;

                        var changes = {};
                        changes[e.target.name] = value;

                        var destinationColumn = $target.data("destination-column");
                        if (typeof destinationColumn !== "undefined" && e.target.name !== destinationColumn) {
                            changes[destinationColumn] = value;
                        }

                        TaskServices.notifyTaskDataChanged(_activeTask, changes, { override: true, origin: _GADGET_TAG });
                    }
                }
            }
        });

        $('#task-area').delegate('.task-contact-area', 'change', function (e) {
            // By 'standard' behaviour, the contact area should only have the main contact selector
            // which selects the appropriate template.
            if ($(e.target).hasClass('mainselector')) {
                var $template = $(this).find('.template-control-area');
                var $templateOverflow = $(this).find('.task-template-overflow-area');

                if (!isNaN($(e.target).val())) {
                    var test = $(e.target).children('[value=' + $(e.target).val() + ']');

                    if (test) {
                        // show the fields from the view model associated with 
                        // this contact selector
                        _showContactViewModel(test, $template, $templateOverflow);

                        var renderTarget = $(e.target).closest('.task-contact-area');
                        _populateViewModel(renderTarget, _activeTask.TaskData);
                        if (_activeTask && _activeTask.Status !== "PARKED")
                            _triggerAddressValueChange(renderTarget);
                    }

                    var changes = {};
                    changes[e.target.name] = $(e.target).val();
                    TaskServices.notifyTaskDataChanged(_activeTask, changes, { override: true, origin: _GADGET_TAG });
                }
            }
        });

        $('#task-area').delegate('div[data-sub-id]', 'change keyup', function (e) {
            if (e.which && e.which !== 13) return;

            var templateArea, templateOverflowArea, detailArea, taskNotes, detailSelector, selector, cloned;
            if ($(e.target).hasClass('mainselector')) {
                templateArea = $(this).find('.template-control-area');
                templateOverflowArea = $(this).find('.task-template-overflow-area');
                detailArea = $(this).find('[data-field-type=secondaryselector]');
                taskNotes = $(this).find('.task-notes-area');

                templateArea.children().remove();
                templateOverflowArea.children().remove();

                detailArea.addClass("hidden");

                taskNotes.removeClass('hidden');
                if (!isNaN($(e.target).val())) {
                    selector = $(e.target).children('[value=' + $(e.target).val() + ']');
                    if (selector) {
                        _showReasonViewModel(selector, templateArea, templateOverflowArea, detailArea, taskNotes);
                    }
                } else {
                    taskNotes.addClass('hidden');
                }
            } else if ($(e.target).hasClass('secondaryselector')) {
                templateArea = $(this).find('.template-control-area');
                templateOverflowArea = $(this).find('.task-template-overflow-area');
                taskNotes = $(this).find('.task-notes-area');

                templateArea.children().remove();
                templateOverflowArea.children().remove();

                if (!isNaN($(e.target).val())) {
                    selector = $(e.target).children('[value=' + $(e.target).val() + ']');

                    if (selector) {
                        _showDetailViewModel(selector, templateArea, templateOverflowArea, taskNotes);
                    }
                }
            }

            var $interactionTab = $(e.target).closest("div[data-sub-id]");
            var interactionIndex = parseInt($interactionTab.data("sub-id")) - 1;
            var interactionKey = "interaction" + interactionIndex;
            var interactionData = _getInteractionData($interactionTab);

            var changes = {};
            changes[interactionKey] = JSON.stringify(interactionData);
            TaskServices.notifyTaskDataChanged(_activeTask, changes, { override: true, origin: _GADGET_TAG });
        });

        // handlers for the add/remove tab buttons
        $('#task-area').delegate('.task-reason-tab-header', 'click', function (e) {
            var button = $(e.target);
            var $tabHeader = $(this);
            var $tabArea = $(this.parentElement);
            var taskData = {};

            if (button.hasClass('addTabButton')) {
                _addNewSubInteraction($tabArea, $tabHeader);

                // Grab the changes due to the new tab and notify
                taskData = _grabSubInteractionTaskData($tabArea);
                TaskServices.notifyTaskDataChanged(_activeTask, taskData, { override: true, origin: _GADGET_TAG });
            } else if (button.hasClass('close')) {
                var $parent = $(e.target.parentElement);
                var value = $parent.attr('data-sub-id');

                if (value == 1) {
                    gadgets.Hub.publish('com.upstreamworks.alertr.alert', _localization.InteractionCapture.CannotRemove);
                } else {
                   gadgets.Hub.publish('com.upstreamworks.alertr.confirm', {
                        message: _localization.InteractionCapture.DiscardInteractionMsg,
                        context: this,
                        callback: function(truth) {
                            if (truth) {
                                $parent.remove();

                                var $test1 = $tabArea.find('div[data-sub-id=' + value + ']');

                                $test1.remove();

                                var query = $tabArea.find('.task-reason-tab');

                                if (query.length === 0) {
                                    _addNewSubInteraction($tabArea, $tabHeader);

                                    // ensure we can add.
                                    $tabHeader.find(".addTabButtonTab").show();

                                } else if (query.length < 5) {
                                    $tabHeader.find(".addTabButtonTab").show();

                                    _selectTab($tabArea, 1);
                                }

                                // Fix tab numbers.....This may get altered in FIN-438
                                var $tabPages = $tabArea.find('div[data-sub-id]');

                                // The pages themselves
                                if ($tabPages.length) {
                                    var count = 1;
                                    for (count = 1; count <= $tabPages.length; count++) {
                                        $tabPages.eq(count - 1).attr('data-sub-id', count);
                                    }
                                }

                                // the tab headers
                                var $headers = $tabHeader.find('li[data-sub-id]');

                                if ($headers.length) {
                                    for (count = 1; count <= $headers.length; count++) {
                                        $headers.eq(count - 1).attr('data-sub-id', count);
                                        $headers.eq(count - 1).find('a').text(count);
                                    }
                                }

                                // Grab the changes due to deletion and renumbering
                                taskData = _grabSubInteractionTaskData($tabArea);
                                // Then make sure we allow for the deleted entry overwrite
                                taskData['interaction' + $tabPages.length] = "";
                                // And notify
                                TaskServices.notifyTaskDataChanged(_activeTask, taskData, { override: true, origin: _GADGET_TAG });
                            }
                        }
                    });
                }
            } else {
                var test = button.text();

                if (test.indexOf("+") < 0) {
                    _selectTab($tabArea, test);

                    // Grab the changes due to the new selection and notify
                    taskData = _grabSubInteractionTaskData($tabArea);
                    TaskServices.notifyTaskDataChanged(_activeTask, taskData, { override: true, origin: _GADGET_TAG });
                }
            }
        });

        if (upstream.gadget.Config.enableExtCRM === "true") {
            //if (upstream.gadget.Config.extCRMBtnCaption &&
            //	upstream.gadget.Config.extCRMBtnCaption !== "")
            //{ 
            //	$('.crm-btn').text(upstream.gadget.Config.extCRMBtnCaption);
            //}

            $('.crm-menu').removeClass('hide');
            _populateCRMlnks();
        };

        // mimicking focus / blur event for elements all elements
        (function () {
            var $current = $();

            var _hasBounded = function (elm, event) {
                var bounded = $(elm).data("events");
                return bounded && event in bounded;
            }

            $(document).on("focusin click", $.proxy(function (e) {
                var $active = $(e.target).parents().addBack();

                // triggering focus for tracked panels which are not active previously
                $active.not($current)
                    .filter(function () { return _hasBounded(this, "active"); })
                    .trigger("active");
                // triggering blur for tracked panels which are previouly active
                $current.not($active)
                    .filter(function () { return _hasBounded(this, "inactive"); })
                    .trigger("inactive");

                $current = $active;
            }, this));
        })();

        TaskServices.init({
            gadgetTag: "InteractionCapture",
            taskStateChanged: _processTaskStateChanged,
            taskDataChanged: _processTaskDataChanged,
            activeTaskChanged: _processActiveTaskChanged,
            taskCompleting: _taskCompleting
        });

        _adjustHeight();
    };

    return {
        init: function () {
            _hub = gadgets.Hub;
            _prefs = new gadgets.Prefs();
            _loadingConfig = false;
            _localization = upstream.gadget.locale;

            _loadingIntervalEventID = setInterval(
                function () {
                    _tryLoadConfig();
                }
                , 2000
            );
            _tryLoadConfig();

            _adjustHeight();
        },

        crmPop: function (el) {
            if (_activeTask) {
                _hub.publish('com.upstreamworks.events.CRMButtonClick', _activeTask);

                var uiCid = $.trim($('#' + _activeTaskId).find('#ContactId').val());
                var uiSA = $.trim($('#' + _activeTaskId).find('#SourceAddress').val());

                var taskForCRM = _activeTask;
                var $taskData = _getTaskDataFromUI(_activeTask);
                if ($taskData) {
                    upstream.Logger.debug('InteractionCapture', 'crmPop: Replacing TaskData');
                    taskForCRM.TaskData = $taskData;
                }

                var crmId = $(el).data('crmid');
                if (crmId && taskForCRM) {

                    if (uiCid !== "") taskForCRM.TaskData.ContactId = uiCid;
                    if (uiSA !== "") taskForCRM.TaskData.SourceAddress = uiSA;
                    upstream.modules.crmPop.OpenCRMPop(crmId, taskForCRM, "CRMButtonClick", function (data) {
                        if (data) {
							
							//RKRKRK: Oct 26, to override taskData based on values from CRM Btn 
							var crmOptions = new Object;
							crmOptions.override = true;
							
                            var notify = {
                                originalTask: taskForCRM,
                                changedTask: data,
								options: crmOptions
                            };

                            _hub.publish('com.upstreamworks.events.taskDataChanged', notify);
                        }

                    });
                }
            }

        },

        uniPop: function (el) {
            // pops first link if only one
            var btnlnks = $(el).siblings('.crm-ul').find('[data-crmid]');
            if (btnlnks.length < 2) {
                btnlnks.click();
                $(el).siblings('.crm-ul').css("display", "none");
            }
        }
    };
}(jQuery));
