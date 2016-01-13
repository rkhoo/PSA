/* WebPopProvider
* 
*  Client: Farm Bereau
*
*  Oct 16, 2015 rkhoo   Created based on FB Provider 2.4.1.5  
*  Nov 13, 2015 rkhoo   Added DI COntactype select HDA, HDS and HDE, what are these?
*                       Exceed pop is based on ContacType = 35, use ContactId, else use MemeberID2
*/

using System;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Services.Protocols;
using System.ServiceModel;
using System.Net;
using System.Net.Http;

using UpstreamWorks.Debugging;
using UpstreamWorks.WebPop;
using System.IO;
using System.Runtime.Serialization.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace UpstreamWorks.FBProvider
{
    public class FBProvider : IWebPopProvider
    {
        private readonly  FBItem ConfigItem;

        #region Constructor
        public FBProvider(String crmId)
        {            
            GE.prtlog("FBProvider Initialized (Deployment Nov 13, 2015)");            
            ConfigItem = FBConfig.GetFBConfigItem(crmId);
        }
        #endregion
        
        public WebPopData GetUrl(dynamic taskContext)
        {
            String url = String.Empty;
            try
            {
                var result = new WebPopData();

                //(taskContext.TriggerAction can be "unpark", "CRMButtonClick", "accept")

                if (taskContext.TriggerAction == "CRMButtonClick")
                {
                    // Get AD Result
                    GE.dprt("CRM Btn Get AD Search Result");
                    result = BuildUrlADResult(taskContext);
                }
                else 
                {
                    // both both Exceed and AD Search
                    GE.dprt("Pop Exceed and ADSearch");
                    result = BuildTwoUrl(taskContext);
                }
                

                return result;
            }
            catch (Exception ex)
            {
                GE.eprt("Error in FBProvider.GetExceedUrl.");
                GE.DumpException(ex);
            }

            return null;
        }

        #region Private Members

        private WebPopData BuildTwoUrl(dynamic taskContext)
        {
            var result = new WebPopData();

            if (ConfigItem == null)
            {
                GE.eprt("BuildTwoUrl: No configuration loaded");
                return result;
            }
                        
            string MemberID = string.Empty;
            try
            {
                dynamic taskData = taskContext.TaskData;
                // http:
                // 10.33.10.191:8095/ReturnExceedLink.aspx?agent=jjones&mbr=997381
                if (taskData.ContactType == 35)
                {
                    MemberID = string.Format("{0}", taskData.ContactId);                
                }
                else
                {
                    MemberID = string.Format("{0}", taskData.MemberID2);                
                }
                
            }
            catch (Exception e)
            {
                GE.eprt("missing MemberID, '{0}'", e.Message);
                MemberID = string.Empty;
            }

            string AgentID = string.Empty;
            try
            {
                dynamic agentDetails = taskContext.AgentDetails;                
                AgentID = string.Format("{0}", agentDetails.Login);
            }
            catch (Exception e)
            {
                GE.eprt("missing Agent ID, '{0}'", e.Message);
                AgentID = string.Empty;
            }

            string urlExceed = string.Format(ConfigItem.BaseExceedUrl, AgentID, MemberID);
            string urlADSearch = string.Format(ConfigItem.BaseADSearchUrl, AgentID);

            GE.dprt("Two URL is '{0}', '{1}'", urlExceed, urlADSearch);

            result.Url = urlExceed;
            result.Meta.Add("POPURL1", urlExceed);
            result.Meta.Add("POPURL2", urlADSearch);
            
            return result;
        }

        private WebPopData BuildUrlADResult(dynamic taskContext)
        {
            var result = new WebPopData();

            if (ConfigItem == null)
            {
                GE.eprt("BuildUrlADResult: No configuration loaded");
                return result;
            }

            string AgentID = string.Empty;
            string DesktopInstance = string.Empty;

            try
            {
                dynamic agentDetails = taskContext.AgentDetails;
                AgentID = string.Format("{0}", agentDetails.Login);
                DesktopInstance = string.Format("{0}", agentDetails.DesktopInstance);
            }
            catch (Exception e)
            {
                GE.eprt("missing Agent ID, '{0}'", e.Message);
                AgentID = string.Empty;
            }

            string urlADGet = string.Format(ConfigItem.BaseADGetUrl, AgentID);

            GE.dprt("Get AD Search '{0}'", urlADGet);

            var webReq = (HttpWebRequest)WebRequest.Create(urlADGet);
            string content = string.Empty;
            dynamic ADResult = new JObject();
            
            using (WebResponse response = webReq.GetResponse())
            {
                GE.eprt("Response from AD Search:'{0}'", ((HttpWebResponse)response).StatusDescription);
                using (StreamReader responseStream = new StreamReader(response.GetResponseStream()))
                {                    
                    content = responseStream.ReadToEnd();                    
                }
            }

            content = content.Substring(content.IndexOf("{"));
            content = content.Remove(content.LastIndexOf("}")+1);
            
            GE.eprt("Results from AD Search:'{0}'", content);

            ADResult = Newtonsoft.Json.JsonConvert.DeserializeObject(content);

            GE.dprt("   Finesse AgentID:'{0}'", ADResult.AgentID);
            GE.dprt("   LastSelectedName:'{0}'", ADResult.LastSelectedName);
            GE.dprt("   Department:'{0}'", ADResult.Department);
            GE.dprt("   ContactType:'{0}'", ADResult.ContactType);
            GE.dprt("   ADLogonName:'{0}'", ADResult.LogonName);
            GE.dprt("   LastSelectedID:'{0}'", ADResult.LastSelectedID);


            #region the following section update task object and sent back to the front end to update IC
                        
            // Since there is a change in data, the ContacID, we want to change it on the original taskData object 
            // and send t back to the caller, which is IC.

            result.Meta.Add("contactId", (String)ADResult.LogonName);            
            result.Meta.Add("Name", (String) ADResult.LastSelectedName);
            result.Meta.Add("Department", (String) ADResult.Department);
            
            // using AD result, we select the corret contactType based on DI !

            string myContactType = (string) ADResult.ContactType;
            if (myContactType.ToLower() == "agent")
            {
                if (DesktopInstance == "FarmBureauPS")
                {
                    result.Meta.Add("ContactType", "CC=Agent");
                }
                else 
                {
                    result.Meta.Add("ContactType", "CC=HDA");
                }
                
            }
            else if (myContactType.ToLower() == "secretary")
            {
                if (DesktopInstance == "FarmBureauPS")
                {
                    result.Meta.Add("ContactType", "CC=Secretary");
                }
                else
                {
                    result.Meta.Add("ContactType", "CC=HDS");
                }                
            }
            else
            {
                if (DesktopInstance == "FarmBureauPS")
                {
                    result.Meta.Add("ContactType", "CC=EM");
                }
                else
                {
                    result.Meta.Add("ContactType", "CC=HDE");
                }                 
            }
                       
            
            #endregion

            // there is no URL, just new taskdata for IC
            return result;
        }

        private JsonSerializerSettings ConfigureJSon()
        {
            var toReturn = new JsonSerializerSettings();
            toReturn.PreserveReferencesHandling = Newtonsoft.Json.PreserveReferencesHandling.Objects;
            toReturn.ContractResolver = new DefaultContractResolver()
            {
                IgnoreSerializableInterface = true,
                IgnoreSerializableAttribute = true
            };
            return toReturn;
        }
        
        #endregion
    }
}
