using System;
using System.Collections.Generic;
using System.Collections.Specialized;

using Plato.Configuration;
using UpstreamWorks.Debugging;
using Plato.Configuration.Interfaces;

/*  
 *  FB Exceed and AD Search Utility screen pop and Get 
 * 
*/

namespace UpstreamWorks.FBProvider
{
    public static class FBConfig
    {
        public static FBItem GetFBConfigItem(String webpopId)
        {
            const String conFigFileName ="WebPopSettings.config";

            IConfigContainer cf = ConfigManager.GetConfiguration(String.Format(@"{0}{1}", AppDomain.CurrentDomain.BaseDirectory, conFigFileName));

            if (cf != null)
            {
                GE.dprt("Loaded " + String.Format(@"{0}{1}", AppDomain.CurrentDomain.BaseDirectory, conFigFileName));
            }
            else
            {
                GE.eprt("Cannot load " + String.Format(@"{0}{1}", AppDomain.CurrentDomain.BaseDirectory, conFigFileName));
                return null;
            }

            IConfigNode providerNode = cf.Node.GetConfigNode(String.Format("providers/provider[@webpopId='{0}']", webpopId));
            if (providerNode == null)
            {
                GE.eprt("Cannot find provider in the config file.");
                return null;
            }

            String baseExceedUrl = providerNode.GetAttribute("baseExceedUrl", "url", null);
            if (String.IsNullOrWhiteSpace(baseExceedUrl))
            {
                GE.eprt("Cannot read baseExceedUrl in the config file.");
                return null;
            }

            String baseADSearchUrl = providerNode.GetAttribute("baseADSearchUrl", "url", null);
            if (String.IsNullOrWhiteSpace(baseADSearchUrl))
            {
                GE.eprt("Cannot read baseADSearchUrl in the config file.");
                return null;
            }

            String baseADGetUrl = providerNode.GetAttribute("baseADGetUrl", "url", null);
            if (String.IsNullOrWhiteSpace(baseADGetUrl))
            {
                GE.eprt("Cannot read baseADGetUrl in the config file.");
                return null;
            }

            NameValueCollection parameters = new NameValueCollection();
            List<IConfigNode> paramNodes = providerNode.GetConfigNodes("param");
            foreach (IConfigNode paramNode in paramNodes)
            {
                String name = paramNode.GetAttribute(".", "name", null);
                String value = paramNode.GetAttribute(".", "value", null);

                if (String.IsNullOrWhiteSpace(name) || String.IsNullOrWhiteSpace(value))
                {
                    continue;
                }

                parameters[name] = value;
            }

            return new FBItem()
            {
                BaseExceedUrl = baseExceedUrl,
                BaseADSearchUrl = baseADSearchUrl,
                BaseADGetUrl = baseADGetUrl,
                Parameters = parameters
            };
        }
    }
}
