using System;
using System.Collections.Specialized;

namespace UpstreamWorks.FBProvider
{
    public class FBItem
    {
        public String BaseExceedUrl { get; set; }
        public String BaseADSearchUrl { get; set; }
        public String BaseADGetUrl { get; set; }
        public NameValueCollection Parameters { get; set; }
    }
}
